// use-chat —— the UI state machine for visitor chat: the UI consumes
// Dialog[] state, and internally it runs on VisitorTurnAgent + real prod
// adapters (H.10: the agent loop lives in the backend's eino, the browser
// makes one POST /agent/turn, and SSE events are aggregated into Dialog).
//
// ChatState interface: callers (PageShell / FloatingChatDock / ChatRoom)
// keep getting dialogs / pending / error + ask / reset, unchanged.
//
// Naming (G-1.5):
//   - Turn → Dialog (one round of visitor question + AI answer + cited,
//     aligned with the backend's domain.Dialog)
//   - useConversation → useChat (Chat is the aggregate root, dialog is a
//     child entity)
//   - Citation.kind → genre, Citation.id → path (the backend reuses
//     DocumentGenre; the frontend field names say what they mean)
//
// Event aggregation:
//   - tool_completed corpus_read events → the cited list
//   - Dialog.answer.paras still comes from splitting body; body
//     accumulates from llm_chunk text deltas

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SESSION_GONE_CODE, VisitorTurnAgent, type DocContext } from '@standmeet/agent-core';
import type { EventObserver, Message } from '@standmeet/agent-core';
import {
  forgetBYOAI, readBYOAICredFull, wrapBYOAIKey, type PublicSessionResponse,
} from '@standmeet/sdk-core';

import {
  httpPromptSource, httpAgentTurnStreamer, httpTurnRecovery,
  type HttpBYOAIHeaders,
} from '../agent-adapters.js';
import { chatBaseURL } from './api.js';
import {
  restoreSession, revalidateSession, revalidateStored, seedEphemeralStores,
} from './use-chat-restore.js';
import {
  handleAgentEvent, makeAccumulator, markFailed, newPendingDialog, turnSucceeded, updateDialog,
  type Dialog, type DialogAccumulator,
} from './dialog-stream.js';
import {
  ensureEffectiveSession,
  type PageSession,
  type SessionMode as SessionModeT,
} from './page-session.js';
import { useVisitorSessionStore } from './session-store.js';
import { settleGoneSession } from './session-gone.js';
import { useGhostsStore } from './ghosts-store.js';
import {
  clearPersisted, loadPersisted, saveDialogs, saveHistory,
} from './persist.js';

// CodedError —— a failure the client decides before sending, carrying the same kind of machine
// code the server's error frames carry, so the UI treats both alike.
class CodedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

// errorCodeOf —— the machine code a failure carries: ours (CodedError) or the server envelope's,
// which sdk-core attaches to its errors as `code` (e.g. 'rate_limited' when opening the session).
function errorCodeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

// Domain shapes live in dialog-stream (SRP split); components keep this import path.
export type {
  Answer, Citation, Dialog, ToolCallView, ToolThrobberView,
} from './dialog-stream.js';

export type SessionMode = SessionModeT;

export type ChatState = {
  dialogs: Dialog[];
  pending: boolean;
  error: string | null;
  ask: (q: string) => Promise<void>;
  /**
   * noteEvent —— writes "the visitor did something on a card" into this
   * conversation's history (F-B-9 ⭐⭐).
   *
   * A card's tool call goes through a different path
   * (`mcp-ui:tool` → `POST /sessions/{id}/tools/{name}`) — it executes,
   * returns, and **never touches the conversation**. But this conversation
   * is client-driven: every turn sends this message array out as History.
   * So a cancellation dismissed on a card never happened as far as the
   * agent is concerned — its next line still says "your meeting is still
   * on", directly contradicting the `CANCELLED` shown on the same screen.
   *
   * Written as `system`, not `user`: it's not something the visitor said,
   * it's something that happened in this conversation. It also doesn't
   * count as a turn for this reason (quota only counts visitor messages).
   */
  noteEvent: (text: string) => void;
  reset: () => void;
  // conversationID —— the conversation id this chat lands in (main chat =
  // the one that comes with the session; floating dock = the lazily
  // resolved doc conversation). #122 requires the BookCard's confirmation
  // email to carry it (the backend locates the most recent booking by
  // it). Can start empty (floating dock, before its first question
  // resolves it); must be non-empty by the time BookCard appears.
  conversationID: string;
};

type Deps = {
  mode: SessionMode;
  // docContext —— the doc the visitor is currently on (doc page / floating
  // chat); undefined for the full-screen main chat. Passed through to
  // /agent/turn so the AI can resolve "this" references (#36).
  docContext?: DocContext;
  // persistKey —— keep this conversation in this browser under this key (a page's own thread: a
  // microsite agent, the embed). A reload shows the transcript again and the model still has the
  // history. The main chat has no key: the server restores it (restoreSession).
  persistKey?: string;
  // session —— run on a session the caller issued (see page-session). The owner's self-test. Such a
  // conversation is not this browser's visitor conversation: nothing is restored into it.
  session?: PublicSessionResponse;
  ephemeral?: boolean;
};

export function useChat(deps: Deps): ChatState {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // conversationID —— exposed to BookCard (#122, its confirmation email
  // carries it). Filled from stored when the main chat mounts; synced
  // after each ask resolves the effective conversation (floating dock's
  // doc conversation).
  const [conversationID, setConversationID] = useState<string>('');
  const sessionRef = useRef<PageSession | null>(null);
  const messageHistRef = useRef<Message[]>([]);
  const counter = useRef(0);
  // streamOpenRef / queuedRef —— see the note on ask below (F-A-42): a
  // question sent while a turn is in flight gets queued here, along with
  // the id of the dialog it already went into the transcript as.
  const streamOpenRef = useRef(false);
  const queuedRef = useRef<{ q: string; id: string } | null>(null);
  // Multi-conversation model: the floating dock (has docContext) uses its
  // own conversation, doesn't piggyback on the main one. docConvRef caches
  // the resolved doc conversation_id (lazily POSTs /conversations on the
  // first question); docCtxRef keeps it out of the mount effect's
  // dependency array (the floating dock's conversation isn't restored at
  // mount, only created on its first question — starts empty).
  const docConvRef = useRef<string | null>(null);
  const docCtxRef = useRef(deps.docContext);
  docCtxRef.current = deps.docContext;

  // H.13.d: at mount, if localStorage already has a stored session,
  // restore the ephemeral projections (ghosts/specs/dock/caps) into each
  // store — ensureSession is lazy (only runs on asking a question), so
  // without this the initial chat screen would be empty.
  const persistKey = deps.persistKey;
  // loaded —— the saved thread has reached state. Until then the first commit's empty transcript
  // must not be saved over the stored one.
  const [loaded, setLoaded] = useState(false);
  const ephemeral = deps.ephemeral === true;
  useEffect(() => {
    if (ephemeral) return;
    const stored = seedEphemeralStores();
    // A page's own thread comes back from this browser, not from the server.
    if (persistKey !== undefined) {
      const saved = loadPersisted(persistKey);
      setDialogs(saved.dialogs);
      messageHistRef.current = saved.history;
      setLoaded(true);
      return;
    }
    // The floating dock (has docContext) doesn't restore the main
    // conversation — that's a different one, and mixing them would cross
    // wires. Its own conversation starts empty and is only lazily
    // built/resumed on its first question (ensureEffectiveSession). Only
    // the main chat goes through restoreSession.
    if (docCtxRef.current !== undefined) return;
    // Refresh restore: with a stored session, pull back the main
    // conversation's Q&A by token and rebuild the transcript (a
    // pure-in-memory dialogs array would be empty after a refresh — this
    // fills it back in). On failure → stays empty, doesn't crash, same as
    // now.
    const token = stored?.session_token ?? '';
    const conv = stored?.conversation_id ?? '';
    if (conv !== '') setConversationID(conv);
    // After a refresh, **both** need to be restored: the transcript on
    // screen, and the message array the model sees (F-A-46). Restoring
    // only the former leaves the visitor looking at what they just asked
    // while the model sees a blank slate.
    void restoreIfStored(conv, token, setDialogs, messageHistRef);
  }, [persistKey, ephemeral]);

  // Persist a page's thread once no turn is in flight (not on every streamed token).
  useEffect(() => {
    if (loaded && persistKey !== undefined && !dialogs.some((d) => d.pending)) {
      saveDialogs(persistKey, dialogs);
    }
  }, [loaded, persistKey, dialogs]);

  // The tier changed (the visitor brought their own key, or dropped it): the next turn opens a
  // session on the new tier, and the conversation so far goes with it as history, so the model
  // still remembers.
  // The same holds when the caller hands over a different session (the owner restarts a self-test).
  const lastTier = useRef({ mode: deps.mode, session: deps.session });
  useEffect(() => {
    if (lastTier.current.mode !== deps.mode || lastTier.current.session !== deps.session) {
      sessionRef.current = null;
      docConvRef.current = null;
      setError(null);
    }
    lastTier.current = { mode: deps.mode, session: deps.session };
  }, [deps.mode, deps.session]);

  // The strip's used is **member-level** (the backend's total across all
  // of this person's conversations), no longer counted from local
  // dialogs — under multiple conversations, a single surface's local turn
  // count would undercount. The seed comes from the session issue's
  // quota.used_turns (already member-level), each successfully answered
  // turn optimistically +1 (runAsk), and load/reconcile corrects it
  // against the backend's authoritative value.

  // Switching identity: clicking the name on SessionStrip reopens the
  // picker → issuing a new name issues a new session (new member / new
  // conversation), and the session store's startedAt changes along with
  // it. chat responds by dropping the old transcript + cached session, so
  // the next question starts from the new stored session. The new
  // session's ghosts are already re-seeded by issue, so ghosts aren't
  // touched here.
  const startedAt = useVisitorSessionStore((s) => s.session?.startedAt ?? 0);
  const lastStartedAt = useRef(startedAt);
  useEffect(() => {
    // Only a NEW session (a new non-zero start) starts a new transcript. A session that ends
    // (cleared → 0) leaves the transcript alone: wiping it there erased the visitor's own question
    // when their code was revoked mid-visit (2026-10-04).
    if (lastStartedAt.current !== 0 && startedAt !== 0 && startedAt !== lastStartedAt.current) {
      sessionRef.current = null;
      setDialogs([]);
      setError(null);
      messageHistRef.current = [];
    }
    lastStartedAt.current = startedAt;
  }, [startedAt]);

  const nextID = useCallback((): string => {
    counter.current += 1;
    return `d${counter.current}`;
  }, []);

  // ask —— **no longer drops the second question** while a turn is in
  // flight (F-A-42).
  //
  // This used to be `if (q === '' || pending) return` — the visitor hit
  // send, the input box cleared, and then nothing happened. Global rule
  // #10 is about exactly this: **accept the request and queue it, don't
  // grey it out**; "can't do it right now" shouldn't turn into "you have
  // to remember to hit it again yourself later".
  //
  // "Busy" means two different things, so two variables:
  //   · `pending` (state, drives the UI) = **the visitor is waiting for an
  //     answer**, ends the moment a `done` receipt arrives.
  //   · `streamOpenRef` (ref, controls serialization) = **this turn's
  //     stream is still open** (the epilogue's ghost is still in flight).
  // The former ends early, the latter ends late; the input box watches
  // the former, send-timing watches the latter. Conflating them into one
  // was this bug itself.
  const ask = useCallback(async (text: string): Promise<void> => {
    const q = text.trim();
    if (q === '') return;
    if (streamOpenRef.current) {
      // Queue it, and **put it in the transcript right away**: the
      // visitor needs to see their own message stay put, not vanish into
      // thin air.
      const qid = nextID();
      setDialogs((prev) => [...prev, newPendingDialog(qid, q)]);
      queuedRef.current = { q, id: qid };
      return;
    }
    let job: { q: string; id: string | null } | null = { q, id: null };
    let askedAgain = false;
    while (job !== null) {
      streamOpenRef.current = true;
      let again: string | null = null;
      try {
        again = await runAsk(job.q, deps, { sessionRef, docConvRef, histRef: messageHistRef },
          { setDialogs, setPending, setError, setConvID: setConversationID }, nextID, job.id);
      } finally {
        streamOpenRef.current = false;
      }
      // Its session was gone: ask the same question once more, in the same place, on a fresh one.
      if (again !== null && !askedAgain) {
        askedAgain = true;
        const retry: { q: string; id: string } = { q: job.q, id: again };
        setDialogs((prev) => prev.map((d) => (d.id === retry.id ? newPendingDialog(retry.id, retry.q) : d)));
        job = retry;
        continue;
      }
      // The model's history is final only once the turn's stream closed (agent.send returned).
      if (deps.persistKey !== undefined) saveHistory(deps.persistKey, messageHistRef.current);
      // The queued question is only sent **after the stream is truly
      // closed**: `histRef` isn't written correctly until the previous
      // turn's agent.send returns, and sending early would let the second
      // turn read history that's missing the previous turn. Unlocking (on
      // the done receipt) and send-timing are two separate things.
      job = takeQueued(queuedRef);
    }
  }, [deps, nextID]);

  // noteEvent —— see the note on ChatState. Writes directly to the ref: it
  // doesn't render on screen (the card already shows its own result), what
  // matters is **that it's in the History sent out on the next turn**.
  const noteEvent = useCallback((text: string): void => {
    if (text === '') return;
    messageHistRef.current = [...messageHistRef.current, { role: 'system', content: text }];
  }, []);

  // reset —— a new conversation: the transcript, the model's history, this page's saved copy, and
  // the session (the next question opens a fresh one).
  const reset = useCallback((): void => {
    setDialogs([]);
    setError(null);
    messageHistRef.current = [];
    sessionRef.current = null;
    docConvRef.current = null;
    if (persistKey !== undefined) clearPersisted(persistKey);
    // H.13.d: a new chat session picks up ghosts fresh; not clearing
    // would carry the previous conversation's follow-up queue over.
    useGhostsStore.getState().clear();
  }, [persistKey]);

  return { dialogs, pending, error, ask, noteEvent, reset, conversationID };
}

// restoreIfStored —— with a stored session, restores this conversation:
// the transcript + **the message array the model sees**. Pulled into its
// own function to keep useChat under the line-count gate; both things are
// done together because skipping the latter is exactly F-A-46.
async function restoreIfStored(
  conv: string, token: string,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
  histRef: React.MutableRefObject<Message[]>,
): Promise<void> {
  if (token === '' || conv === '') return;
  await restoreSession(conv, token, setDialogs, (msgs) => { histRef.current = msgs; });
}

// takeQueued —— takes the queued question (clears it once taken). A
// separate function rather than inline in the loop — inline, TS would
// narrow the ref to null and never widen it back (it can't see the ref
// being written externally across an await).
function takeQueued(
  ref: React.MutableRefObject<{ q: string; id: string } | null>,
): { q: string; id: string | null } | null {
  const next = ref.current;
  ref.current = null;
  return next === null ? null : { q: next.q, id: next.id };
}

// AskRefs / AskSetters —— bundles runAsk's refs / setters to avoid too
// many parameters (eslint max-params). docConvRef is new for the
// multi-conversation model: caches the floating dock's conversation id.
interface AskRefs {
  sessionRef: React.MutableRefObject<PageSession | null>;
  docConvRef: React.MutableRefObject<string | null>;
  histRef: React.MutableRefObject<Message[]>;
}

interface AskSetters {
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>;
  setPending: (b: boolean) => void;
  setError: (e: string | null) => void;
  // setConvID —— filled back in after the effective conversation resolves
  // (#122, BookCard needs this conversation id).
  setConvID: (id: string) => void;
}

async function runAsk(
  q: string,
  deps: Deps,
  refs: AskRefs,
  setters: AskSetters,
  nextID: () => string,
  // queuedID —— this question already went into the transcript **when it
  // was queued** (F-A-42); reuse that dialog instead of creating a second
  // one. null = the normal path, create it here.
  queuedID: string | null,
  // Returns the dialog's id when the question should be asked again on a fresh session (its
  // session turned out to be gone), else null.
): Promise<string | null> {
  const { setDialogs, setPending, setError, setConvID } = setters;
  const id = queuedID ?? nextID();
  setError(null);
  setPending(true);
  if (queuedID === null) {
    setDialogs((prev) => [...prev, newPendingDialog(id, q)]);
  }
  try {
    const sess = await ensureEffectiveSession(
      refs.sessionRef, refs.docConvRef, deps, deps.docContext);
    setConvID(sess.conversationID);
    const byoai = await wrapBYOAIFor(deps, sess);
    if (deps.mode === 'byoai' && byoai === undefined) {
      // The key saved in this browser can't be read (prod 2026-09-26: the wrap key was gone from
      // IndexedDB, the envelope still in localStorage). Sending the turn keyless ran it on the
      // owner's provider while the page said "on your key". Don't send: drop the broken entry and
      // ask for the key again.
      forgetBYOAI();
      throw new CodedError('byoai_key_unreadable', 'The AI key saved in this browser can\'t be read any more.');
    }
    const accum = makeAccumulator();
    await runAgentForDialog(sess, byoai, refs.histRef, q,
      // Unlock as soon as the `done` receipt arrives — don't wait for the
      // stream to close (F-A-42). After `done` the server still has an
      // epilogue to run (the ghost is a real LLM call, 10–26 seconds in
      // prod), and that stretch has nothing to do with the visitor.
      makeObserver(id, accum, setDialogs, () => { setPending(false); }), deps.docContext);
    finalizeDialog(id, accum, setDialogs);
    // F-A-9: when policy stays silent (this turn produced no ghost frame)
    // → clear the previous steering ghost, so a stale ghost for an
    // already-visited waypoint doesn't keep hanging on the input box. If a
    // new frame did arrive (ghostReceived), setPolicy has already replaced
    // it, so don't clear. For non-code visitors ghost is always null, so
    // this is a no-op with no side effects.
    if (!accum.ghostReceived) {
      useGhostsStore.getState().clearGhost();
    }
    // The backend owns this turn: the tail end of the /agent/turn stream
    // has already sunk it into the conversation table (#28), the frontend
    // no longer persists it itself. The finished dialog stays in the
    // local transcript for display; used is derived from dialogs (the
    // mirror effect below) and naturally +1s; the source of truth is the
    // backend, and a refresh rebuilds from the conversation via
    // restoreSession. Failure/cut-off (including 401) → revalidate winds
    // down: if the session is dead, clears identity back to the entry
    // flow. Success → optimistic member-level used +1 (any surface burns
    // the same shared budget); failure/cut-off → doesn't count, checks
    // back on whether the session is still alive.
    if (turnSucceeded(accum)) {
      useVisitorSessionStore.getState().incUsed();
    } else if (accum.errorCode === SESSION_GONE_CODE) {
      // The session no longer exists (session-gone.ts): a code that still opens goes back to its
      // entry flow; otherwise the visitor is public now and this question is asked again.
      refs.sessionRef.current = null;
      refs.docConvRef.current = null;
      if (await settleGoneSession()) return id;
    } else {
      void revalidateSession(sess.conversationID, sess.sessionToken);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setDialogs((prev) => markFailed(prev, id, msg, errorCodeOf(e)));
    void revalidateStored();
  } finally {
    setPending(false);
  }
  return null;
}

// wrapBYOAIFor —— in byoai mode, pulls the plaintext key from the vault
// and envelopes it with an AES key derived via HKDF(session_token);
// returns undefined for other modes.
async function wrapBYOAIFor(
  deps: Deps, sess: PageSession,
): Promise<HttpBYOAIHeaders | undefined> {
  if (deps.mode !== 'byoai') return undefined;
  const cred = await readBYOAICredFull();
  if (!cred) return undefined;
  const wrappedKey = await wrapBYOAIKey(cred.key, sess.sessionToken);
  return {
    provider: cred.provider, endpoint: cred.endpoint,
    model: cred.model, wrappedKey,
  };
}

// makeObserver —— onReceipt fires once, right when `turn_finished` (the
// `done` frame) arrives: this turn is over as far as the visitor is
// concerned. The product itself documents this as the only reliable
// receipt (agent-core `agent-turn.ts:125`), yet before F-A-42 **nobody
// listened for it** — the UI treated the stream closing as the wrap-up,
// so the input box stayed locked an extra 10–26 seconds.
function makeObserver(
  dialogID: string,
  accum: DialogAccumulator,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
  onReceipt: () => void,
): EventObserver {
  return {
    onEvent(ev): void {
      handleAgentEvent(ev, accum);
      setDialogs((prev) => updateDialog(prev, dialogID, accum, true));
      if (ev.type === 'turn_finished') onReceipt();
    },
  };
}

function finalizeDialog(
  id: string, accum: DialogAccumulator,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
): void {
  setDialogs((prev) => updateDialog(prev, id, accum, false));
}

async function runAgentForDialog(
  sess: PageSession,
  byoai: HttpBYOAIHeaders | undefined,
  histRef: React.MutableRefObject<Message[]>,
  userMessage: string,
  observer: EventObserver,
  docContext?: DocContext,
): Promise<void> {
  const agent = buildPageAgent(sess, byoai, observer, docContext);
  const next = await agent.send({
    userMessage, history: histRef.current,
  });
  histRef.current = [...next];
}

function buildPageAgent(
  sess: PageSession,
  byoai: HttpBYOAIHeaders | undefined,
  observer: EventObserver,
  docContext?: DocContext,
): VisitorTurnAgent {
  // H.10: the backend (eino ADK) owns the agent loop; the browser makes
  // just one /agent/turn call and receives SSE events. The three ports —
  // blocks / llm / tools — are no longer needed; the whole
  // loop / dispatch lives in the backend now.
  return new VisitorTurnAgent(
    {
      prompts: httpPromptSource({ baseURL: chatBaseURL() }),
      turn: httpAgentTurnStreamer({
        baseURL: chatBaseURL(), sessionToken: sess.sessionToken, byoai,
      }),
      // recovery —— K: a mid-stream SSE drop is healed by pulling the backend's
      // persisted answer (the turn kept generating on a detached context and
      // sank into the conversation table), instead of making the visitor
      // manually refresh. The turn is read back, never re-run.
      recovery: httpTurnRecovery({ baseURL: chatBaseURL(), sessionToken: sess.sessionToken }),
      observer,
    },
    {
      systemPromptPartIDs: sess.systemPromptPartIDs,
      // persona —— this session's dynamic portion (role persona + code
      // prompt + skill list). The backend has always sent it down in
      // /sessions; this used not to pass it through, so it got dropped at
      // PageSession (F-A-36). This line used to be
      // `assembledPartIDs(sess)` — a pass-through function named
      // "assembled" that assembled nothing, and the name happened to
      // hide exactly the missing half.
      persona: sess.persona,
      conversationID: sess.conversationID,
      docContext,
    },
  );
}

