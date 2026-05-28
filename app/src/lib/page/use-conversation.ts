// use-conversation —— Turn[] 状态机：visitor 一问对应一个 Turn，pending
// 阶段渲染 retrieving 点点，SSE token 累加，done 时收 cited refs (id+title)。
//
// 跟旧 use-chat-dock 的差别：
//   - Turn 是页面 inline 流（顺序展开），不是底部浮动 transcript
//   - mode 由 caller 传入（public / code / byoai 不同 session 取号路径）
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
  type BYOAIHeaders,
  type PublicSessionResponse,
  type SSEEvent,
} from '@/lib/api/public';
import { wrapBYOAIKey } from '@/lib/gate/byoai-envelope';
import { readBYOAICredFull, readBYOAIVaultMeta } from '@/lib/gate/byoai-vault';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

export type Citation = {
  // kind 决定渲染链接前缀：wiki → /wiki/<slug>，output → /output/<slug>。
  // (后端目前只返 id+title；slug 留到后续 hydrate，先用 title 显示。)
  kind: 'wiki' | 'output';
  id: string;
  title: string;
};

export type TurnAnswer = {
  paras: string[];
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

export type SessionMode = 'public' | 'code' | 'byoai';

// pickMode / pickBanner 已删 —— mode 现在 page-shell 通过 loadStoredSession()
// 直接从 localStorage 拿，不再从 URL 查询字符串派生。

export type ConversationState = {
  turns: Turn[];
  pending: boolean;
  error: string | null;
  ask: (q: string) => Promise<void>;
  reset: () => void;
};

type Deps = {
  mode: SessionMode;
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
    const byoai = await wrapBYOAIHeadersFor(deps, sess);
    await streamInto(sess, q, id, setTurns, byoai);
    // 成功 → quota 客户端 +1。server 不再 echo（同 visitor 单线增长，client
    // 算得准）。失败不计 —— 模型异常 / 拒码不该扣额。
    bumpVisitorQuota();
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

// bumpVisitorQuota —— 一轮 chat 成功后让 SessionStrip 进度条 +1。
// 跨 tab / 同 tab 全靠 store 自带的 storage event / 自定义事件传播。
function bumpVisitorQuota(): void {
  useVisitorSessionStore.getState().consume(1);
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
  };
}

async function issueFresh(deps: Deps): Promise<PublicSessionResponse> {
  switch (deps.mode) {
    case 'public':
      return issuePublicSession();
    case 'code': {
      // code-mode without a stored session is a flow error; fall back to public
      // so a deep-linked code URL still produces a usable session.
      return issueCodeSession({ code: '' });
    }
    case 'byoai': {
      // browser vault 里没 BYOAI 时这里 provider 暂用 anthropic 占位；后续
      // chat fetch 会因 wrapBYOAIHeaders 返 undefined → 不发 X-BYOAI-* →
      // server 401。实际 byoai 流程都先经 /gate 把 provider+key 存进 vault。
      const meta = readBYOAIVaultMeta();
      return issueBYOAISession({
        byoai_provider: meta?.provider ?? 'anthropic',
      });
    }
  }
}

// StreamState —— streamInto 累积的状态：当前 body + 引用 refs。
interface StreamState {
  body: string;
  citations: readonly Citation[];
}

async function streamInto(
  sess: PublicSessionResponse,
  q: string,
  turnID: string,
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>,
  byoai: BYOAIHeaders | undefined,
): Promise<void> {
  let state: StreamState = { body: '', citations: [] };
  const stream = streamChatMessage(sess.conversation_id, sess.session_token, q, byoai);
  for await (const ev of stream) {
    state = applyEvent(ev, state);
    setTurns((prev) => updateTurn(prev, turnID, state, ev.kind !== 'done'));
  }
  setTurns((prev) => updateTurn(prev, turnID, state, false));
}

// wrapBYOAIHeadersFor —— mode=byoai 时从 browser vault 一次拿齐 cred
// (provider/endpoint/model/key)，HKDF 派生 session-bound AES key 信封 key →
// 返 4 字段 BYOAIHeaders。其他 mode 返 undefined，streamChatMessage 不发
// X-BYOAI-* header，server 自动走 owner key。
async function wrapBYOAIHeadersFor(
  deps: Deps, sess: PublicSessionResponse,
): Promise<BYOAIHeaders | undefined> {
  if (deps.mode !== 'byoai') return undefined;
  const cred = await readBYOAICredFull();
  if (!cred) return undefined;
  const wrappedKey = await wrapBYOAIKey(cred.key, sess.session_token);
  return {
    provider: cred.provider,
    endpoint: cred.endpoint,
    model: cred.model,
    wrappedKey,
  };
}

function applyEvent(ev: SSEEvent, s: StreamState): StreamState {
  switch (ev.kind) {
    case 'token':
      return { ...s, body: s.body + ev.text };
    case 'done':
      return {
        body: s.body,
        citations: refsToCitations(ev.cited_wiki_refs, ev.cited_output_refs),
      };
    case 'error':
      return { ...s, body: s.body || `error: ${ev.message}` };
  }
}

function refsToCitations(
  wikiRefs: readonly { id: string; title: string }[],
  outputRefs: readonly { id: string; title: string }[],
): Citation[] {
  // output 排前面 ——"polished, quote verbatim"，跟 system prompt 优先级一致。
  return [
    ...outputRefs.map((r) => ({ kind: 'output' as const, id: r.id, title: r.title })),
    ...wikiRefs.map((r) => ({ kind: 'wiki' as const, id: r.id, title: r.title })),
  ];
}

function updateTurn(
  prev: Turn[], id: string, state: StreamState, stillPending: boolean,
): Turn[] {
  return prev.map((t) => t.id === id ? withAnswer(t, state, stillPending) : t);
}

function withAnswer(t: Turn, state: StreamState, stillPending: boolean): Turn {
  return {
    ...t,
    pending: stillPending && state.body === '',
    answer: {
      paras: splitParas(state.body),
      citations: state.citations,
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
  return { paras: [`error: ${msg}`], citations: [], private: false, byoaiBlocked: false };
}

