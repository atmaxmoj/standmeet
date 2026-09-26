// use-chat-session.ts —— the chat state-machine hook. Wraps:
//   1) issueSession (requests a visitor session per mode, on the first question)
//   2) streamMessage (each message receives tokens over SSE)
//   3) accumulating the message array; a streaming flag; error surfacing
//
// Design choice: sessionToken lives in the hook's internal state and is never
// exposed to the caller, so the UI doesn't need to care about session
// lifecycle. The caller only calls send(text) and watches messages / streaming.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IssueSessionInput,
  SSEEvent,
  TurnMsg,
} from '@standmeet/sdk-core';
import {
  adoptStoredSession, forgetBYOAI, hasVisitorGrant, isRetrievalTool, pageDocContext,
  readBYOAIVaultMeta, storeBYOAI,
  type BYOAICredFull,
} from '@standmeet/sdk-core';
import { byoaiHeaders, issueChatSession, savedKeyInUse } from './chat-byok.js';
import { useStandMeet } from './provider.js';

export interface ChatMessage {
  id: string;
  role: 'visitor' | 'assistant';
  text: string;
  citedWikiIDs?: readonly string[];
  // cards —— tools this turn ran that ship their own ui:// card (ask_visitor's question). Same
  // cards the main chat renders; the html comes from the session's tool_specs.
  cards?: readonly ChatCard[];
}

// ChatCard —— one tool's card: its html (sandboxed by the renderer) + the raw result it shows.
export interface ChatCard {
  tool: string;
  result: string;
  html: string;
}

// ChatTool —— the tool the agent is running right now, for a progress throbber. null = plain thinking.
export interface ChatTool {
  name: string;
  label: string;
}

export interface ChatState {
  messages: readonly ChatMessage[];
  streaming: boolean;
  tool: ChatTool | null;
  error: string | null;
  // errorCode —— the machine code of the last turn's error ('rate_limited', …), so the UI can offer
  // a way forward (bring your own key) instead of only saying what went wrong.
  errorCode: string | null;
  byok: ChatBYOK;
  send: (text: string) => Promise<void>;
  // clear —— the visitor wipes this page's conversation: transcript, its localStorage copy, and the
  // client's remembered history. The next question starts a fresh conversation.
  clear: () => void;
}

// ChatBYOK —— the visitor's own key for this chat (see chat-byok.ts). active: turns run on it.
export interface ChatBYOK {
  // available —— may this visitor bring a key at all. Never for a coded visitor: the code's owner
  // pays for their turns (owner rule 2026-09-25), so they are never asked to — even when the code's
  // own quota is spent or its provider rate-limits, and even if a key is saved in this browser.
  available: boolean;
  active: boolean;
  // saved —— a key is saved in this browser (e.g. from /gate) but not in use; useSaved switches to it.
  saved: boolean;
  useSaved: () => void;
  provider: string | null;
  // use —— save the key (encrypted, this browser) and continue the conversation on it.
  use: (cred: BYOAICredFull) => Promise<void>;
  // forget —— drop the saved key; the next turn goes back to the owner's tier.
  forget: () => void;
}

// ChatOptions —— autoUseSavedKey: start on a key already saved in this browser. Only when the
// owner's tier can't serve (owner rule: BYOK is for when the owner has no quota — a saved key must
// not quietly take over while the owner's quota is fine).
export interface ChatOptions {
  autoUseSavedKey?: boolean;
}

export function useChatSession(input: IssueSessionInput, opts: ChatOptions = {}): ChatState {
  const client = useStandMeet();
  // Restore this page's transcript from localStorage (page-granular key), so a reload keeps the chat.
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadPersisted());
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<ChatTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // granted —— this visitor holds a code (read once, at mount: /gate stores it before the page).
  const [granted] = useState(() => hasVisitorGrant());
  const [byokActive, setByokActive] = useState(
    () => !granted && opts.autoUseSavedKey === true && savedKeyInUse(),
  );
  const sessionRef = useRef<{ id: string; token: string; system: string; byoai: boolean } | null>(null);
  // messagesRef —— the live transcript, so switching to the visitor's key can carry it as history.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // cardHTML —— tool name → its ui:// card html, from the session's tool_specs.
  const cardHTML = useRef<Record<string, string>>({});
  // The transcript as restored at mount — seeded back as history on the first turn so the model
  // remembers across the reload. Seeded once (the client accumulates the rest itself thereafter).
  const restoredRef = useRef<readonly ChatMessage[]>(messages);
  const seededRef = useRef(false);
  const counter = useRef(0);
  // Per-mount prefix: restored messages keep the ids they were saved with ("m1", "m2", …), and a
  // counter restarting at 1 after a reload handed new messages the same ids — duplicate React keys.
  const idPrefix = useRef(Math.random().toString(36).slice(2, 8));
  const nextID = useCallback((): string => {
    counter.current += 1;
    return `${idPrefix.current}-${counter.current}`;
  }, []);

  // Persist the transcript once a turn settles (not on every streamed token). Wrapped in try/catch
  // inside savePersisted, so blocked/full storage degrades to "no persistence", never a throw.
  useEffect(() => { if (!streaming) savePersisted(messages); }, [messages, streaming]);

  const clear = useCallback((): void => {
    setMessages([]);
    clearPersisted();
    restoredRef.current = [];
    seededRef.current = true; // nothing to seed
    if (sessionRef.current) client.clearHistory(sessionRef.current.id);
    sessionRef.current = null; // a fresh conversation on the next question
    setError(null);
    setErrorCode(null);
    setTool(null);
  }, [client]);

  // restartOnTier —— the next turn opens a fresh session (the tier changed) and seeds it with the
  // conversation so far, so the model still remembers.
  const restartOnTier = useCallback((): void => {
    sessionRef.current = null;
    restoredRef.current = messagesRef.current.filter((m) => m.text !== '');
    seededRef.current = false;
    setError(null);
    setErrorCode(null);
  }, []);

  const byok: ChatBYOK = {
    available: !granted,
    active: byokActive,
    saved: !granted && !byokActive && savedKeyInUse(),
    useSaved: () => {
      if (granted) return;
      setByokActive(true);
      restartOnTier();
    },
    provider: byokActive ? (readBYOAIVaultMeta()?.provider ?? null) : null,
    use: async (cred) => {
      if (granted) return; // a coded visitor's turns stay on the code
      await storeBYOAI(cred);
      setByokActive(true);
      restartOnTier();
    },
    forget: () => {
      forgetBYOAI();
      setByokActive(false);
      restartOnTier();
    },
  };

  const send = useCallback(async (text: string): Promise<void> => {
    setError(null);
    setErrorCode(null);
    setStreaming(true);
    setTool(null);
    appendVisitor(setMessages, text, nextID());
    const assistantID = nextID();
    appendAssistant(setMessages, assistantID);
    try {
      if (!sessionRef.current) {
        // Adopt any session already issued in this browser first. **The page is
        // a rendering of that code**: the reader arrived carrying the code, so
        // the agent on the page must be that code's agent — the same
        // authorization, the same quota, the same accounting. Opening a fresh
        // anonymous session instead looks identical on screen, but the reader's
        // name, allotment, and turn count all get silently dropped. Only open a
        // fresh session from `input` when there's no issued session to adopt
        // (a passing anonymous reader).
        // A code's grant wins; otherwise the visitor's own key when one is in use.
        const adopted = adoptStoredSession();
        const s = adopted ?? await issueChatSession(client, input, byokActive);
        // The system prompt is assembled once per session (fragment + this
        // session's persona). Skipping assembly means an empty system prompt,
        // and the answers that come out have nothing to do with this owner
        // (F-O-2).
        sessionRef.current = {
          id: s.conversation_id, token: s.session_token,
          system: await client.composeSystem(s), byoai: adopted === null && byokActive,
        };
        cardHTML.current = cardsByTool(s.tool_specs);
      }
      // First turn after a restore: seed the restored transcript as this conversation's history, so
      // the model remembers what was said before the reload. Once — the client accumulates the rest.
      if (!seededRef.current) {
        seededRef.current = true;
        if (restoredRef.current.length > 0) {
          client.seedHistory(sessionRef.current.id, toTurnMsgs(restoredRef.current));
        }
      }
      const sess = sessionRef.current;
      // pageDocContext: the page the visitor is on, so "can I use it?" means this page.
      const headers = await byoaiHeaders(sess.byoai, sess.token);
      if (sess.byoai && headers === undefined) {
        // The key saved in this browser can't be read (prod 2026-09-26: the wrap key was gone from
        // IndexedDB, the envelope still in localStorage). Sending the turn keyless ran it on the
        // owner's provider while this widget said "on your key". Don't send: drop the broken entry
        // and ask for the key again.
        forgetBYOAI();
        setByokActive(false);
        sessionRef.current = null;
        setMessages((ms) => ms.filter((m) => m.id !== assistantID));
        setError(KEY_UNREADABLE);
        setErrorCode('byoai_key_unreadable');
        return;
      }
      const turn = client.streamMessage(sess.id, sess.token, text, sess.system, headers, pageDocContext());
      for await (const ev of turn) {
        applyEvent(setMessages, assistantID, ev, cardHTML.current);
        if (ev.kind === 'tool') setTool(ev.name === null ? null : { name: ev.name, label: ev.label });
        if (ev.kind === 'token') setTool(null); // real text is streaming → drop the throbber
        if (ev.kind === 'error') {
          setError(ev.message);
          setErrorCode(ev.code);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setTool(null);
    }
  }, [client, input, nextID, byokActive]);

  return { messages, streaming, tool, error, errorCode, byok, send, clear };
}

// KEY_UNREADABLE —— the error's plain-English form; the widget shows its catalog translation by code.
const KEY_UNREADABLE = 'The AI key saved in this browser can\'t be read any more — add it again.';

// ---- page-granular localStorage persistence ----

const CHAT_KEY_PREFIX = 'sm-chat:';
// MAX_PERSIST —— cap the stored transcript so a long conversation can't balloon localStorage. The
// most recent turns are what a returning visitor and the model both need.
const MAX_PERSIST = 40;

// pageKey —— one stored conversation per page (the URL path). Different pages keep separate chats.
function pageKey(): string {
  try {
    return CHAT_KEY_PREFIX + (typeof location === 'undefined' ? '' : location.pathname);
  } catch {
    return CHAT_KEY_PREFIX;
  }
}

function loadPersisted(): ChatMessage[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(pageKey());
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    // withoutCards also cleans storage written before cards stopped being persisted.
    return Array.isArray(parsed) ? parsed.filter(isChatMessage).map(withoutCards) : [];
  } catch {
    return [];
  }
}

function savePersisted(messages: readonly ChatMessage[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // Text only: a card's html is a snapshot of that turn, and persisting it resurrected stale
    // cards (old palette, old bugs) on every reload.
    const keep = messages.filter((m) => m.text !== '').map(withoutCards).slice(-MAX_PERSIST);
    if (keep.length === 0) {
      localStorage.removeItem(pageKey());
      return;
    }
    localStorage.setItem(pageKey(), JSON.stringify(keep));
  } catch {
    /* private mode / quota exceeded — persistence is best-effort */
  }
}

function clearPersisted(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(pageKey());
  } catch {
    /* ignore */
  }
}

function withoutCards(m: ChatMessage): ChatMessage {
  return m.citedWikiIDs === undefined
    ? { id: m.id, role: m.role, text: m.text }
    : { id: m.id, role: m.role, text: m.text, citedWikiIDs: m.citedWikiIDs };
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m['id'] === 'string' && typeof m['text'] === 'string'
    && (m['role'] === 'visitor' || m['role'] === 'assistant');
}

// toTurnMsgs —— the restored transcript as the client's history wire shape (visitor → user).
function toTurnMsgs(messages: readonly ChatMessage[]): TurnMsg[] {
  return messages
    .filter((m) => m.text !== '')
    .map((m) => ({ role: m.role === 'visitor' ? ('user' as const) : ('assistant' as const), content: m.text }));
}

function appendVisitor(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  text: string, id: string,
): void {
  setMessages((prev) => [...prev, { id, role: 'visitor', text }]);
}

function appendAssistant(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, id: string,
): void {
  setMessages((prev) => [...prev, { id, role: 'assistant', text: '' }]);
}

function applyEvent(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  id: string, ev: SSEEvent, cardHTML: Record<string, string>,
): void {
  setMessages((prev) => prev.map((m) => {
    if (m.id !== id) return m;
    if (ev.kind === 'token') return { ...m, text: m.text + ev.text };
    if (ev.kind === 'done') return { ...m, citedWikiIDs: ev.cited_wiki_ids };
    if (ev.kind === 'tool') return withCard(m, ev.completed, cardHTML);
    return m;
  }));
}

// withCard —— a finished tool that ships a card gets it attached to this turn's message.
// Retrieval tools don't (same rule as the main chat): the throbber already says "searching".
function withCard(
  m: ChatMessage, done: { name: string; result: string } | undefined,
  cardHTML: Record<string, string>,
): ChatMessage {
  const html = done === undefined || isRetrievalTool(done.name) ? '' : (cardHTML[done.name] ?? '');
  if (done === undefined || html === '') return m;
  return { ...m, cards: [...(m.cards ?? []), { tool: done.name, result: done.result, html }] };
}

// cardsByTool —— tool name → ui:// card html, for the tools that ship one.
function cardsByTool(
  specs: readonly { name: string; ui_html?: string }[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of specs ?? []) {
    if (s.ui_html !== undefined && s.ui_html !== '') out[s.name] = s.ui_html;
  }
  return out;
}
