// use-live-transcript —— the owner's live view of one conversation (docs/design/notify-rules-and-
// live-transcript.md). The link's token opens the conversation so far, then a stream of the very
// frames the visitor's own turn carries; a `turn` frame starts the next exchange with its question.
// Each frame goes through the same reducer the visitor's chat uses, so both render a turn alike.

'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { agentEventOf } from '@standmeet/agent-core';

import { agentTurnEventOf, parseSSEFrames, type SSEFrame } from '../agent-turn-sse.js';
import { fetchLiveConversation, openLiveStream } from './api.js';
import {
  handleAgentEvent, makeAccumulator, newPendingDialog, updateDialog,
  type Dialog, type DialogAccumulator,
} from './dialog-stream.js';
import { dialogsOf } from './use-chat-restore.js';

export type LiveState = 'loading' | 'invalid' | 'open';

type SetDialogs = Dispatch<SetStateAction<Dialog[]>>;

// LiveTurn —— the exchange the stream is currently filling ('' = none yet).
interface LiveTurn { id: string; acc: DialogAccumulator; seq: number }

export function useLiveTranscript(token: string): { state: LiveState; dialogs: Dialog[] } {
  const [state, setState] = useState<LiveState>('loading');
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    void follow(token, abort.signal, setState, setDialogs);
    return () => { abort.abort(); };
  }, [token]);
  return { state, dialogs };
}

// follow —— subscribe first, then read what was said: a turn that starts in between is heard.
// ponytail: a turn that FINISHES in between shows twice (history + stream); dedupe if it bites.
async function follow(
  token: string, signal: AbortSignal, setState: (s: LiveState) => void, setDialogs: SetDialogs,
): Promise<void> {
  const body = await openLiveStream(token, signal);
  const past = await fetchLiveConversation(token);
  if (body === null || past === null) {
    setState('invalid');
    return;
  }
  setDialogs(dialogsOf(past));
  setState('open');
  const turn: LiveTurn = { id: '', acc: makeAccumulator(), seq: 0 };
  try {
    for await (const frame of parseSSEFrames(body)) applyFrame(frame, turn, setDialogs);
  } catch {
    // the page went away (abort) or the stream dropped: the transcript keeps what it has
  }
}

function applyFrame(frame: SSEFrame, turn: LiveTurn, setDialogs: SetDialogs): void {
  if (frame.event === 'turn') {
    startTurn(turn, questionOf(frame.data), setDialogs);
    return;
  }
  const ev = agentTurnEventOf(frame);
  if (ev === null || ev.type === 'ghost') return;
  if (turn.id === '') startTurn(turn, '', setDialogs); // joined mid-turn: the question went by
  handleAgentEvent(agentEventOf(ev), turn.acc);
  const id = turn.id;
  const stillPending = ev.type !== 'done' && ev.type !== 'error';
  setDialogs((prev) => updateDialog(prev, id, turn.acc, stillPending));
}

function startTurn(turn: LiveTurn, q: string, setDialogs: SetDialogs): void {
  turn.seq += 1;
  turn.id = `live-${turn.seq}`;
  turn.acc = makeAccumulator();
  const dialog = newPendingDialog(turn.id, q);
  setDialogs((prev) => [...prev, dialog]);
}

function questionOf(data: string): string {
  try {
    const q = (JSON.parse(data) as { q?: unknown }).q;
    return typeof q === 'string' ? q : '';
  } catch {
    return '';
  }
}
