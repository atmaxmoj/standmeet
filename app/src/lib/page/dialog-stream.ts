// dialog-stream.ts —— the Dialog domain + the pure SSE-event → Dialog reducer.
//
// Split out of use-chat.ts (SRP): this module is React-free — it owns the Dialog shapes,
// the per-turn DialogAccumulator, the agent-event reducer (handleAgentEvent), and the
// Dialog update/finalize pures. use-chat.ts keeps the React orchestration (hook, ask flow,
// observer glue); components keep importing the types via use-chat's re-exports.

import type { AgentEvent } from '@standmeet/agent-core';

import { throbberLabel } from '@/lib/page/throbber-label';
import { pickCorpusReadShape, citableCorpusRead } from '@/lib/page/corpus-read-wire';
import { useCapabilityStore } from '@/lib/visitor/capability-store';
import { useGhostsStore } from '@/lib/visitor/ghosts-store';
import { logger } from '@/lib/logger';

export type Citation = {
  genre: 'wiki' | 'output' | 'writing';
  // id —— stable entry identifier, used for the cited_*_ids in the admin
  // transcript (not reverse-looked-up from path, which sidesteps a pitfall
  // where tree paths don't line up under an ACL subset). path is only for
  // UI display.
  id: string;
  path: string;
  // slug —— only writings have one, **used for linking** (`corpusHref`).
  // The path column is a human-readable location, not an address: on the
  // public site writings are addressed by slug, and building a URL from
  // path 404s.
  slug: string;
  title: string;
  // G-3: corpus_read already has body in hand; storing it on the citation
  // lets the UI expand the original text on click, saving an extra backend
  // fetch (+ a second ACL evaluation).
  body: string;
};

// Answer —— everything the assistant produced this turn: prose paragraphs +
// citations + the tools it called. The visitor only ever produces q; a tool
// call is always assistant-initiated, so toolCalls belongs to Answer. ACL /
// slicing is already locked down at the retrieval layer (the agent can't
// read outside its scope), so there's no "mark private after generation"
// step, and hence no private/byoaiBlocked flag here.
export type Answer = {
  paras: string[];
  citations: readonly Citation[];
  toolCalls: readonly ToolCallView[];
  // notice —— the line told to the visitor when this turn **didn't wrap up
  // normally**, hung next to whatever content already streamed out. It's a
  // separate field rather than folded into paras: a truncated passage and
  // "it got truncated" are two different things, and mixing them reads as
  // if the author wrote it that way on purpose (F-A-32). Empty = the turn
  // ended normally.
  notice?: string;
};

// ToolCallView —— G-4: tool_completed accumulates into Dialog; the UI
// dispatches on name to render it (corpus_search hits / calendar_book
// confirmation / generic JSON dump for skill_* / ext_*). result is raw
// unknown; the rendering layer narrows it itself.
//
// result is **optional**: results from the retrieval family (corpus_*)
// are never sent to the visitor at all (F-A-28, they contain note bodies) —
// the live stream sends an empty string, and refresh-restore omits the
// field entirely. The UI only counts these calls, never renders their
// body, so "no result" is the **normal** state on this channel, not an
// anomaly. Making it required would make the type lie, and that lie is
// exactly where restore used to fall apart.
export type ToolCallView = {
  name: string;
  ok: boolean;
  result?: unknown;
};

// ToolThrobberView —— a per-tool progress row: name feeds the
// `tool-throbber-<name>` testid, label is the already-assembled
// human-readable copy (throbber-label.ts).
export type ToolThrobberView = {
  name: string;
  label: string;
};

export type Dialog = {
  id: string;
  q: string;
  time: string;
  pending: boolean;
  // answer is always present (starts as an empty object); during
  // streaming, paras/toolCalls get added to it, and pending means it
  // hasn't wrapped up yet. toolCalls lives inside answer (assistant
  // output), no longer a top-level Dialog field.
  answer: Answer;
  // throbber = the observer's **real-time** view of the agent: holds only
  // the "current" activity — the most recent tool_started, replaced as
  // soon as the next tool starts, cleared to null once the turn lands.
  // Pure UI transient state, not persisted (the persistent receipt is
  // answer.toolCalls). label is assembled by throbber-label.ts.
  currentTool: ToolThrobberView | null;
  // retrying —— the backend transport is retrying a transient LLM
  // failure; the throbber shows "retrying" instead of "retrieving". The
  // next text/tool progress event clears it naturally.
  retrying: boolean;
  // failed —— this turn didn't produce an answer (error fallback /
  // cut off). The strip's used count excludes it: only turns that
  // finished count (count = number of dialogs with !pending && !failed).
  failed: boolean;
};


export interface DialogAccumulator {
  body: string;
  citations: Citation[];
  seenCitedIDs: Set<string>;
  // currentTool —— the current throbber activity (most recent
  // tool_started); toolSeq is a monotonic counter, kept only to give
  // corpus_read's verb rotation (reading / pulling up / ...) a stable idx.
  currentTool: ToolThrobberView | null;
  toolSeq: number;
  toolCalls: ToolCallView[];
  retrying: boolean;
  // errorMsg —— the human-readable message from a backend `error` event
  // (including the stream-cut fallback); non-empty → the dialog wraps up
  // rendered as an answer paragraph instead of blank.
  errorMsg: string;
  // ghostReceived —— whether this turn received a `ghost_received` frame.
  // F-A-9: when policy stays silent (no frame) for a turn, wrap-up must
  // **clear** the previous ghost, or the input box keeps showing a stale
  // ghost for an already-visited waypoint.
  ghostReceived: boolean;
  // stopReason —— **why** this turn stopped (the value carried verbatim
  // by the done frame).
  //
  // Stores the raw value rather than a `truncated: boolean` (UX-84): a
  // boolean can only answer "did it finish or not", but what the visitor
  // needs to know is **which kind of wall** — running out of output
  // budget vs. hitting the wall while chaining tool calls mean different
  // next steps for them. The moment it's narrowed to a boolean, "each kind
  // of wall gets to state its own reason" becomes impossible
  // (same as [[empty-is-not-json-null]]: flattening the distinction at the
  // entry point leaves downstream with no way to tell them apart).
  //
  // `end_turn` = finished normally; other values are looked up in
  // STOP_NOTICE, and if not found, no notice is shown.
  stopReason: string;
  // claimUnbacked —— this turn's answer claims it accomplished something,
  // but this turn **has no receipt for it** (the done frame's
  // stop_reason=claim_unbacked). Decided on the backend, because only it
  // knows which tools this turn called and whether they came back with a
  // receipt.
  claimUnbacked: boolean;
}

export function makeAccumulator(): DialogAccumulator {
  return {
    body: '', citations: [], seenCitedIDs: new Set(),
    currentTool: null, toolSeq: 0, toolCalls: [], retrying: false, errorMsg: '',
    ghostReceived: false, stopReason: 'end_turn', claimUnbacked: false,
  };
}


export function handleAgentEvent(ev: AgentEvent, accum: DialogAccumulator): void {
  if (ev.type === 'llm_chunk') {
    accum.body += ev.text;
    // Answer starts streaming out → clear the throbber to make room for
    // the answer (the throbber holds on from tool_started up to here).
    accum.currentTool = null;
    accum.retrying = false; // progress resumed
    return;
  }
  if (ev.type === 'tool_started') {
    // F-A-4 P1 — a tool_started proves the text streamed so far this round was the model
    // narrating its plan: process, not the answer. Fold it out of the answer body (matches
    // what the backend persists, 122e922); the throbber takes over as the activity indicator.
    accum.body = '';
    // Replace, don't accumulate: the throbber always reflects only the
    // tool the agent is running right now.
    accum.currentTool = {
      name: ev.name,
      label: throbberLabel(ev.name, ev.args, ev.progressLabel, accum.toolSeq),
    };
    accum.toolSeq += 1;
    accum.retrying = false;
    return;
  }
  if (ev.type === 'tool_completed') {
    logger.info('chat tool_completed', { name: ev.result.name, ok: ev.result.ok });
    accum.toolCalls.push({
      name: ev.result.name, ok: ev.result.ok, result: ev.result.result,
    });
    pushCitationFromTool(ev.result, accum);
    // Don't clear the throbber on tool_completed: keep it up until
    // llm_chunk (answer starts) clears it, so "reading X" carries through
    // the "done reading → LLM composes the answer" stretch (the tens of
    // seconds DeepSeek can take there) — otherwise the tool round trip
    // flashes by and is never actually seen. Between tools, currentTool is
    // replaced by the next tool_started; before the first tool it's null
    // → the thinking word shows.
    accum.retrying = false;
    return;
  }
  if (ev.type === 'retrying') {
    // The backend is retrying a transient LLM failure → the throbber
    // shows "retrying".
    accum.retrying = true;
    return;
  }
  if (ev.type === 'error') {
    // A backend `error` event (including the frontend's stream-cut
    // fallback): render the human-readable message as the wrap-up instead
    // of leaving the dialog blank. Clear retrying.
    accum.errorMsg = ev.message;
    accum.retrying = false;
    return;
  }
  if (ev.type === 'answer_recovered') {
    // The SSE was cut mid-stream, but the backend finished on its detached
    // context and persisted the turn (K). This is that authoritative answer,
    // pulled back without re-running the turn. Replace the partial that
    // streamed in before the drop, drop the throbber, and clear the cut-error
    // that would otherwise have wrapped up the dialog.
    accum.body = ev.text;
    accum.currentTool = null;
    accum.errorMsg = '';
    accum.retrying = false;
    return;
  }
  if (ev.type === 'capability_state_changed') {
    useCapabilityStore.getState().setStates(ev.states);
    return;
  }
  if (ev.type === 'turn_finished') {
    // Keep the stop reason **verbatim**. This value travels all the way
    // from the provider through the backend's sink.Done to the browser —
    // it used to get thrown away once the SSE parse finished, so nobody
    // could tell whether a turn wrapped up or got truncated (F-A-34);
    // later I collapsed it into a `truncated` boolean, which erased
    // "which wall" again (UX-84). Store the raw value; STOP_NOTICE decides
    // what to say.
    accum.stopReason = ev.stopReason;
    // claim_unbacked isn't a stop the model gave — it's **the product's own
    // judgment**: this turn's answer claims it accomplished something, but
    // this turn has no receipt for it (F-A-37).
    accum.claimUnbacked = ev.stopReason === 'claim_unbacked';
    return;
  }
  if (ev.type === 'ghost_received') {
    // Ghost P4: after code-accessor finishes a turn, backend policy emits
    // **a single** steering ghost; swap the input-box ghost for this one
    // (non-code visitor backends never send this, so this is a dead
    // branch there).
    accum.ghostReceived = true;
    useGhostsStore.getState().setPolicy(ev.text, ev.ghostId, ev.targetWaypoint);
  }
}

function pushCitationFromTool(
  result: { name: string; result?: unknown; ok: boolean },
  accum: DialogAccumulator,
): void {
  if (!result.ok || result.name !== 'corpus_read') return;
  const r = pickCorpusReadShape(result.result);
  if (r === null || !citableCorpusRead(r)) return;
  // Dedup by id before storing: reading the same entry multiple times
  // cites it only once.
  if (r.id === '' || accum.seenCitedIDs.has(r.id)) return;
  accum.seenCitedIDs.add(r.id);
  accum.citations.push({
    genre: r.genre, id: r.id, path: r.path, slug: r.slug, title: r.title, body: r.body,
  });
}


function emptyAnswer(): Answer {
  return { paras: [], citations: [], toolCalls: [] };
}

export function newPendingDialog(id: string, q: string): Dialog {
  return {
    id, q, time: nowHM(), pending: true, answer: emptyAnswer(),
    currentTool: null, retrying: false, failed: false,
  };
}

// turnSucceeded —— whether this turn counts as a "successful reply": got a
// non-empty answer and didn't go through the error fallback. Decides
// whether to consume quota (only a success gets recorded + bumped).
export function turnSucceeded(accum: DialogAccumulator): boolean {
  return accum.errorMsg === '' && accum.body !== '';
}


export function updateDialog(
  prev: Dialog[], id: string, accum: DialogAccumulator, stillPending: boolean,
): Dialog[] {
  return prev.map((d) => d.id === id ? withAnswer(d, accum, stillPending) : d);
}

function withAnswer(d: Dialog, accum: DialogAccumulator, stillPending: boolean): Dialog {
  return {
    ...d,
    // error / answer already has content → no longer pending; while
    // retrying, body stays empty but it's still pending.
    pending: stillPending && accum.body === '' && accum.errorMsg === '',
    retrying: stillPending && accum.retrying,
    // The throbber is the observer's **real-time** view of the agent: it
    // reflects the current tool while the observer is still receiving
    // events (stillPending); the moment a turn lands (finalize,
    // stillPending=false) it's cleared to null — once the agent stops
    // moving there's nothing left to observe. The persistent receipt is
    // toolCalls below (tool_completed), not this.
    currentTool: stillPending ? accum.currentTool : null,
    // The error fallback (errorMsg non-empty) = this turn didn't produce
    // an answer, doesn't count.
    failed: accum.errorMsg !== '',
    // answer is always present: not a single character streamed out →
    // render only the human-readable line; some already streamed out →
    // **keep both** (the partial body + citations + a line saying "it
    // didn't finish"); normal case → prose + citations. toolCalls are
    // always included (cards that ran should stay even if the turn
    // ultimately errored).
    answer: answerFor(accum),
  };
}

// answerFor —— see withAnswer. Split out to keep withAnswer's branches
// readable.
//
// F-A-32: this used to be "if there's an errorMsg, swap the whole thing for
// that line", so a turn that had run 47 reads and accumulated 43 citations
// would have **everything vanish** from the visitor's view the moment it
// failed to wrap up, leaving only "connection dropped". The opposite is
// just as bad: saying nothing lets a half-finished plan narration pass
// itself off as the answer. Keeping both is correct.
// TRUNCATED_NOTICE —— the line hung below the answer when the output
// budget runs out.
//
// **This line's wording and shape weren't invented here** (UX-84): it's
// the same kind of event as "this session is done" — a quota ran out and
// the product stops to tell the visitor. The other side of that, after
// 50/50, says `session full` (`ChatRoom.tsx`'s `ComposerAction`, vermillion
// monospace lowercase), so this side says `turn full` — same root word,
// same lettering. **One event, one way of saying it**: I originally wrote
// my own line here, "this answer was cut short — ask for the rest, or
// narrow the question" — that was never designed, and it promised an extra
// "rest" that doesn't exist when `answer_chars=0`.
//
// Uses the same notice slot F-A-32 built (partial body + citations + a
// human-readable line, all kept).
// STOP_NOTICE —— **each kind of wall states its own reason** (UX-84).
//
// Don't hardcode one line: there's more than one kind of wall, and "why
// did it stop" is exactly what the visitor wants to know. Hardcoding one
// line means the next kind of wall just inherits the previous line's
// wording — that's exactly how this bug happened (I once wrote "ask for
// the rest" for `stop_reason=max_tokens`, and there's no rest when
// `answer_chars=0`).
//
// The root word matches the neighboring quota-exhausted state
// (`ChatRoom.tsx`'s `SESSION FULL`): running out of quota is always
// `… FULL`, everything else speaks for itself. Backend adds a new stop
// kind → add one line here; **an unregistered stop kind shows no notice**
// (better to say nothing than to borrow someone else's reason).
//
// The backend-side counterpart is `normalizedStop` (proxy_wire.go): it
// passes through the product's own judgment verbatim, and normalizes what
// comes from upstream. Both sides add the two halves of the same thing.
const STOP_NOTICE: Readonly<Record<string, string>> = {
  // The model ran out of output budget, **the body is there, just
  // unfinished** — same category as "this session is done", a quota ran
  // out.
  max_tokens: 'turn full · output budget',
  // Kept calling tools until it hit the wall, the body is there (F-A-35's
  // first sighting was its empty-answer variant).
  tool_use: 'turn full · spent on lookups',
  // **Not a single character came back, and there's nothing to recover**
  // (decided by the backend's `doneStop`, F-A-35).
  //
  // The wording is **deliberately different** from the two above: those
  // two say "didn't finish", so you can ask "what about the rest"; this
  // one says "there's nothing", and the only useful next step is to
  // narrow the question. This case used to share "ask for the rest" with
  // the other two — promising a rest that doesn't exist.
  no_answer: 'no answer this turn · try a narrower question',
  // **Ran out of time**, and even the deadline-side rescue didn't make it
  // in time (F-A-44). What it looks like in the real environment: it read
  // 64 notes, and six minutes later the visitor sees *"The connection
  // dropped before a reply came back. Please try asking again."* — the
  // connection was fine, it hit the time wall, and "ask again" would hit
  // the same wall.
  //
  // Wording kept separate from `no_answer`: that one is "found nothing
  // at all", this one is "found a lot, didn't get to put it together in
  // time" — and the `SEARCHED n · READ m` line on screen is still there,
  // so the visitor can see how much it actually did.
  deadline: 'out of time · it read a lot and couldn’t finish · ask about one piece of it',
};

// UNBACKED_CLAIM_NOTICE —— the answer above claims it did something for
// you, and this turn **has no receipt for it** (F-A-37: in the real
// environment, a turn that said "Booked. ✅ … Invite went to …" never
// called a single tool, and there was nothing on the calendar). The
// characters that already streamed out can't be taken back, so the
// product spells it out next to them: **don't plan your time around it**.
// Decided on the backend (the done frame's stop_reason=claim_unbacked),
// this side only has to say it in plain language.
const UNBACKED_CLAIM_NOTICE =
  'nothing was actually done for this one — the reply above says otherwise, '
  + 'but no action went through. Please ask again, and don’t rely on it until it confirms.';

function answerFor(accum: DialogAccumulator): Answer {
  if (accum.errorMsg === '') {
    return {
      paras: splitParas(accum.body), citations: accum.citations,
      toolCalls: [...accum.toolCalls],
      ...(noticeFor(accum) === '' ? {} : { notice: noticeFor(accum) }),
    };
  }
  if (accum.body === '') {
    return { paras: [accum.errorMsg], citations: [], toolCalls: [...accum.toolCalls] };
  }
  return {
    paras: splitParas(accum.body), citations: accum.citations,
    toolCalls: [...accum.toolCalls], notice: accum.errorMsg,
  };
}

// noticeFor —— whether this turn should hang a line from the product next
// to the answer. **An unbacked claim outranks truncation**: a passage
// that didn't finish makes someone ask again; a promise that never
// happened makes someone show up to a meeting for nothing.
function noticeFor(accum: DialogAccumulator): string {
  if (accum.claimUnbacked) return UNBACKED_CLAIM_NOTICE;
  return STOP_NOTICE[accum.stopReason] ?? '';
}

export function markFailed(prev: Dialog[], id: string, msg: string): Dialog[] {
  return prev.map((d) =>
    d.id === id ? { ...d, pending: false, retrying: false, failed: true, answer: errorAnswer(msg) } : d);
}

function errorAnswer(msg: string): Answer {
  return { paras: [`error: ${msg}`], citations: [], toolCalls: [] };
}

// splitParas —— splits body text into paragraphs on blank lines (used for
// dialog rendering; restore also uses it to rebuild history).
export function splitParas(body: string): string[] {
  return body.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s !== '');
}

function nowHM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
