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
import { adoptStoredSession, isRetrievalTool, pageDocContext } from '@standmeet/sdk-core';
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
  send: (text: string) => Promise<void>;
  // clear —— the visitor wipes this page's conversation: transcript, its localStorage copy, and the
  // client's remembered history. The next question starts a fresh conversation.
  clear: () => void;
}

export function useChatSession(input: IssueSessionInput): ChatState {
  const client = useStandMeet();
  // Restore this page's transcript from localStorage (page-granular key), so a reload keeps the chat.
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadPersisted());
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<ChatTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ id: string; token: string; system: string } | null>(null);
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
    setTool(null);
  }, [client]);

  const send = useCallback(async (text: string): Promise<void> => {
    setError(null);
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
        const s = adoptStoredSession() ?? await client.issueSession(input);
        // The system prompt is assembled once per session (fragment + this
        // session's persona). Skipping assembly means an empty system prompt,
        // and the answers that come out have nothing to do with this owner
        // (F-O-2).
        sessionRef.current = {
          id: s.conversation_id, token: s.session_token,
          system: await client.composeSystem(s),
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
      const turn = client.streamMessage(sess.id, sess.token, text, sess.system, undefined, pageDocContext());
      for await (const ev of turn) {
        applyEvent(setMessages, assistantID, ev, cardHTML.current);
        if (ev.kind === 'tool') setTool(ev.name === null ? null : { name: ev.name, label: ev.label });
        if (ev.kind === 'token') setTool(null); // real text is streaming → drop the throbber
        if (ev.kind === 'error') setError(ev.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setTool(null);
    }
  }, [client, input, nextID]);

  return { messages, streaming, tool, error, send, clear };
}

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
