// use-conversation —— Turn[] 状态机：visitor 一问对应一个 Turn，pending
// 阶段渲染 retrieving 点点，SSE token 累加，done 时收 cited_wiki_ids。
//
// 跟旧 use-chat-dock 的差别：
//   - Turn 是页面 inline 流（顺序展开），不是底部浮动 transcript
//   - tier 由 caller 传入（public / code / byoai 不同 session 取号路径）
//   - 不再做 ref-batched 模式 —— 每次 token 都生成新 Turn[] 数组，因为
//     React 19 useTransition + structural sharing 够用，stale closure 不
//     是 v1 必须解决的事

'use client';

import { useCallback, useRef, useState } from 'react';

import {
  issueBYOAISession,
  issueCodeSession,
  issuePublicSession,
  streamChatMessage,
  type PublicSessionResponse,
  type SSEEvent,
} from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';

export type Citation = {
  date: string;
  title: string;
};

export type TurnAnswer = {
  paras: string[];
  cited: readonly string[];
  citations: readonly Citation[];
  private: boolean;
  byoaiBlocked: boolean;
};

export type Turn = {
  id: string;
  q: string;
  time: string;
  pending: boolean;
  answer: TurnAnswer | null;
};

export type SessionTier = 'public' | 'code' | 'byoai';

// pickTier / pickBanner 已删 —— tier 现在 page-shell 通过 loadStoredSession()
// 直接从 localStorage 拿，不再从 URL 查询字符串派生。

export type ConversationState = {
  turns: Turn[];
  pending: boolean;
  error: string | null;
  ask: (q: string) => Promise<void>;
  reset: () => void;
};

type Deps = {
  tier: SessionTier;
};

export function useConversation(deps: Deps): ConversationState {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PublicSessionResponse | null>(null);
  const counter = useRef(0);

  const nextID = useCallback((): string => {
    counter.current += 1;
    return `t${counter.current}`;
  }, []);

  const ask = useCallback(async (text: string): Promise<void> => {
    const q = text.trim();
    const blocked = q === '' || pending;
    blocked || (await runAsk(q, deps, sessionRef, setTurns, setPending, setError, nextID));
  }, [deps, pending, nextID]);

  const reset = useCallback((): void => {
    setTurns([]);
    setError(null);
  }, []);

  return { turns, pending, error, ask, reset };
}

async function runAsk(
  q: string,
  deps: Deps,
  sessionRef: React.MutableRefObject<PublicSessionResponse | null>,
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>,
  setPending: (b: boolean) => void,
  setError: (e: string | null) => void,
  nextID: () => string,
): Promise<void> {
  const id = nextID();
  setError(null);
  setPending(true);
  setTurns((prev) => [...prev, newPendingTurn(id, q)]);
  try {
    const sess = await ensureSession(sessionRef, deps);
    await streamInto(sess, q, id, setTurns);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setTurns((prev) => markFailed(prev, id, msg));
  } finally {
    setPending(false);
  }
}

function newPendingTurn(id: string, q: string): Turn {
  return { id, q, time: nowHM(), pending: true, answer: null };
}

function nowHM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

async function ensureSession(
  ref: React.MutableRefObject<PublicSessionResponse | null>,
  deps: Deps,
): Promise<PublicSessionResponse> {
  return ref.current ?? (ref.current = await issueSessionFor(deps));
}

async function issueSessionFor(deps: Deps): Promise<PublicSessionResponse> {
  const stored = loadStoredSession();
  return stored
    ? reuseStored(stored)
    : await issueFresh(deps);
}

function reuseStored(stored: NonNullable<ReturnType<typeof loadStoredSession>>): PublicSessionResponse {
  return {
    session_token: stored.session_token,
    conversation_id: stored.conversation_id,
    included_tags: [],
    excluded_tags: [],
  };
}

async function issueFresh(deps: Deps): Promise<PublicSessionResponse> {
  switch (deps.tier) {
    case 'public':
      return issuePublicSession();
    case 'code': {
      // code-tier without a stored session is a flow error; fall back to public
      // so a deep-linked code URL still produces a usable session.
      return issueCodeSession({ code: '' });
    }
    case 'byoai':
      return issueBYOAISession({ byoai_provider: 'anthropic', byoai_key: '' });
  }
}

async function streamInto(
  sess: PublicSessionResponse,
  q: string,
  turnID: string,
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>,
): Promise<void> {
  let body = '';
  let cited: readonly string[] = [];
  for await (const ev of streamChatMessage(sess.conversation_id, sess.session_token, q)) {
    const next = applyEvent(ev, body, cited);
    body = next.body;
    cited = next.cited;
    setTurns((prev) => updateTurn(prev, turnID, body, cited, ev.kind !== 'done'));
  }
  setTurns((prev) => updateTurn(prev, turnID, body, cited, false));
}

function applyEvent(
  ev: SSEEvent, body: string, cited: readonly string[],
): { body: string; cited: readonly string[] } {
  switch (ev.kind) {
    case 'token':
      return { body: body + ev.text, cited };
    case 'done':
      return { body, cited: ev.cited_wiki_ids };
    case 'error':
      return { body: body || `error: ${ev.message}`, cited };
  }
}

function updateTurn(
  prev: Turn[], id: string,
  body: string, cited: readonly string[], stillPending: boolean,
): Turn[] {
  return prev.map((t) => t.id === id ? withAnswer(t, body, cited, stillPending) : t);
}

function withAnswer(t: Turn, body: string, cited: readonly string[], stillPending: boolean): Turn {
  return {
    ...t,
    pending: stillPending && body === '',
    answer: {
      paras: splitParas(body),
      cited,
      citations: [],
      private: false,
      byoaiBlocked: false,
    },
  };
}

function splitParas(body: string): string[] {
  const trimmed = body.trim();
  return trimmed === '' ? [] : trimmed.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
}

function markFailed(prev: Turn[], id: string, msg: string): Turn[] {
  return prev.map((t) => t.id === id ? { ...t, pending: false, answer: errorAnswer(msg) } : t);
}

function errorAnswer(msg: string): TurnAnswer {
  return { paras: [`error: ${msg}`], cited: [], citations: [], private: false, byoaiBlocked: false };
}

