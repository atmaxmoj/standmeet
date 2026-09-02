// use-chat-restore —— load-time restore + reconcile. Fetches the backend's
// session aggregate (GET /sessions/<conv>) using conversation id + token:
//   - rebuilds the transcript (historical Q&A, with citations)
//   - corrects the strip's used / max / seat / name against the backend's
//     authoritative values (the backend conversation + code is the one
//     source of truth)
//   - if the token is already invalid (401) → clear the old identity, go
//     back to the entry flow depending on whether there's a code
//
// Race protection: the aggregate is an async request fired at mount time,
// and it can resolve later than a turn the user asked on a whim in the
// meantime. That turn already bumped used +1 locally and pushed a new
// dialog into the transcript, and the late-arriving old aggregate must
// not overwrite it — used is only adopted if it hasn't been touched
// locally during the fetch; the transcript is only rebuilt if it's
// currently empty.
//
// splitParas also lives here (use-chat's withAnswer uses it too, importing
// it back).

'use client';

import type { Dispatch, SetStateAction } from 'react';

import type { Message } from '@standmeet/agent-core';

import {
  fetchConversation,
  type AggDialog, type ConvEvent, type DialogCitation, type VisitorView,
} from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { splitParas, type Citation, type Dialog } from '@/lib/page/dialog-stream';
import { useCapabilityStore } from '@/lib/visitor/capability-store';
import { useDockButtonsStore } from '@/lib/visitor/dock-buttons-store';
import { useGhostsStore } from '@/lib/visitor/ghosts-store';
import { recoverFromDeadSession } from '@/lib/visitor/session-recovery';
import { useVisitorSessionStore, type VisitorSession } from '@/lib/visitor/session-store';
import { useToolSpecsStore } from '@/lib/visitor/tool-specs-store';

type DialogSetter = Dispatch<SetStateAction<Dialog[]>>;

// seedEphemeralStores —— on startup (mount/refresh), restore the stored
// blob's ephemeral projections into each store: ghosts / tool_specs
// (including per-tool ui_html) / dock buttons / capabilities.
// ensureSession is lazy (only runs on asking a question), so without this
// seeding the initial chat screen would be empty (buttons wouldn't
// render, externalized cards wouldn't render). Returns stored so the
// caller can pull token/conv to rebuild the transcript.
export function seedEphemeralStores(): ReturnType<typeof loadStoredSession> {
  const stored = loadStoredSession();
  useGhostsStore.getState().seed(stored?.ghosts ?? []);
  useToolSpecsStore.getState().setSpecs(stored?.tool_specs ?? []);
  useDockButtonsStore.getState().setButtons(stored?.dock_buttons ?? []);
  useCapabilityStore.getState().setStates(stored?.capabilities ?? []);
  return stored;
}


// restoreSession —— pull the session at load time: alive → reconcile +
// rebuild transcript; invalid → clear identity, back to entry flow;
// jittery (error) → leave things as they are, don't crash.
export async function restoreSession(
  conversationID: string, token: string, setDialogs: DialogSetter,
  setHistory: HistorySetter = () => undefined,
): Promise<void> {
  const res = await fetchConversation(conversationID, token);
  if (res.status === 'invalid') {
    recoverFromDeadSession();
    return;
  }
  if (res.status !== 'ok') return;
  applyView(res.view, setDialogs);
  setHistory(historyFrom(res.view));
}

export type HistorySetter = (msgs: Message[]) => void;

// historyFrom —— folds the fetched-back transcript into **the message
// array the model sees** (F-A-46).
//
// Why this must exist: this conversation is client-driven — every turn
// sends the message array it's holding as History. After a refresh the
// transcript gets rebuilt (`applyView`), but that message array **is
// empty** — so the screen still shows what was just asked, but the model
// sees none of it, and the visitor's next follow-up lands in a vacuum.
//
// Only folds Q/A + events: citations and tool cards are **presentation**,
// and the model side already gets what it needs from tool results
// directly; but something the visitor did on a card (canceled that
// meeting / sent the confirmation email) has no other way to reach the
// model — without folding it back in, after a refresh the agent will
// think that meeting still stands (F-B-9).
//
// Merged by time, not events dumped at the end: the order the model reads
// them in must match the order they happened in.
function historyFrom(v: VisitorView): Message[] {
  const timed = [...dialogMsgs(v.dialogs), ...eventMsgs(v.events)];
  timed.sort((a, b) => a.at - b.at);
  return timed.map((t) => t.msg);
}

interface TimedMsg { at: number; msg: Message }

function dialogMsgs(ds: readonly AggDialog[]): TimedMsg[] {
  const out: TimedMsg[] = [];
  for (const d of ds) {
    const at = Date.parse(d.created_at);
    if (d.question !== '') out.push({ at, msg: { role: 'user', content: d.question } });
    if (d.answer !== '') out.push({ at, msg: { role: 'assistant', content: d.answer } });
  }
  return out;
}

function eventMsgs(es: readonly ConvEvent[]): TimedMsg[] {
  return es.map((e): TimedMsg => ({
    at: Date.parse(e.created_at), msg: { role: 'system', content: e.text },
  }));
}

// revalidateSession —— after a chat turn errors, checks back whether the
// session is still alive (invalid → wind down), without rebuilding the
// transcript (the current conversation is still in memory, leave it
// alone).
export async function revalidateSession(conversationID: string, token: string): Promise<void> {
  const res = await fetchConversation(conversationID, token);
  if (res.status === 'invalid') {
    recoverFromDeadSession();
    return;
  }
  if (res.status === 'ok') reconcileView(res.view);
}

// revalidateStored —— same as above, but pulls conv id + token from the
// stored session (used in the catch branch when sess isn't available).
// No credentials → skip.
export async function revalidateStored(): Promise<void> {
  const stored = loadStoredSession();
  const token = stored?.session_token ?? '';
  const conv = stored?.conversation_id ?? '';
  if (token !== '' && conv !== '') await revalidateSession(conv, token);
}

function applyView(v: VisitorView, setDialogs: DialogSetter): void {
  reconcileView(v);
  // Rebuild the transcript only if it's currently empty — don't overwrite
  // a turn the user just asked during the fetch.
  if (v.dialogs.length > 0) setDialogs((prev) => (prev.length === 0 ? toDialogs(v) : prev));
}

// reconcileView —— overwrites the local display cache (identity + code
// quota + member-level used) with the backend's authoritative values.
// used is taken as the backend's **member-level** total (can't be counted
// from a single surface's local dialogs under multiple conversations);
// only runs at load / failure wind-down, never competing with a
// successful turn's optimistic +1. byoai (no code, no quota) is left
// untouched. If the backend name is empty, keeps the local one
// (anonymous fallback).
function reconcileView(v: VisitorView): void {
  const cur = useVisitorSessionStore.getState().session;
  if (cur === null || cur.byoai) return;
  useVisitorSessionStore.getState().setSession(mergeView(cur, v));
}

function mergeView(cur: VisitorSession, v: VisitorView): VisitorSession {
  return {
    ...cur,
    max: v.maxTurns,
    // used is authoritative as the backend's **member-level** total
    // (undercounts if computed from a single surface's local dialogs
    // under multiple conversations). reconcile only runs at load /
    // failure wind-down, never competing with a successful turn's
    // optimistic +1, so adopting the backend value directly here won't
    // overwrite the turn just sent.
    used: v.usedTurns,
    maxMembers: v.maxMembers,
    memberCount: v.memberCount,
    visitor: v.visitorName !== '' ? v.visitorName : cur.visitor,
  };
}

function toDialogs(v: VisitorView): Dialog[] {
  return v.dialogs.map((d, i): Dialog => ({
    id: `h${i}`, q: d.question, time: '', pending: false,
    currentTool: null, retrying: false, failed: false,
    answer: {
      paras: splitParas(d.answer), citations: toCitations(d.citations),
      toolCalls: [...d.tool_calls],
    },
  }));
}

// toCitations —— rebuilds the aggregate's citations (genre/path/title)
// into a frontend Citation. id/body aren't available on restore and
// aren't needed (CitationRow only uses genre/path to compute the link,
// and title for display).
//
// slug is always empty, and this is **not** a shortcut being cut: the
// stored `DialogCitationSchema`'s genre enum only has `wiki | output` —
// writings never appear in the persisted transcript at all, so this path
// never reaches the branch that would need slug.
// (This incidentally explains why that href bug only ever showed up on
// the live turn: after a refresh, a writing citation disappears entirely.
// That's a separate gap in the same family — noted, not expanded on in
// this pass.)
function toCitations(cites: readonly DialogCitation[] | undefined): Citation[] {
  return (cites ?? []).map((c): Citation => ({
    genre: c.genre, id: '', path: c.path, slug: '', title: c.title, body: '',
  }));
}
