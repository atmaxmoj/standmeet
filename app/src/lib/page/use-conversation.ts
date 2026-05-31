// use-conversation —— D 期切到 pi-agent-core (在 browser 里跑 LLM ↔ tool
// loop)，UI 跟之前同样吃 Turn[] state 但内部走 useAgent + 真 prod adapters。
//
// 同样保留 ConversationState 接口：caller (PageShell / FloatingChatDock /
// ChatRoom) 不变。
//
// 改动:
//   - 老 streamChatMessage(/messages SSE token-by-token) → useAgent.send()
//     (browser-side loop, /inference/stream + /sessions/{id}/tools/{name})
//   - 老 SSE done.cited_wiki_refs → tool_completed corpus_read 事件聚合
//   - Turn.answer.paras 仍由 body 拆段；body 从 llm_chunk text deltas 累积

'use client';

import { useCallback, useRef, useState } from 'react';
import { VisitorAgent } from '@standmeet/agent-core';
import type {
  AgentEvent, EventObserver, Message, ToolSpecRegistry,
} from '@standmeet/agent-core';
import {
  httpPromptSource, httpInferenceStreamer, httpToolDispatcher,
  type HttpBYOAIHeaders,
} from '@standmeet/sdk';

import {
  issueBYOAISession, issueCodeSession, issuePublicSession,
  type PublicSessionResponse,
} from '@/lib/api/public';
import { wrapBYOAIKey } from '@/lib/gate/byoai-envelope';
import { readBYOAICredFull, readBYOAIVaultMeta } from '@/lib/gate/byoai-vault';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import {
  useCapabilityStore, zustandCapabilityStateSource,
} from '@/lib/visitor/capability-store';

export type Citation = {
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
  // D-5: per-tool throbber 序列。agent-core 跑每个 tool 时 tool_started
  // → name 入这个列表，ConversationDeck 渲一条 "searching corpus..." /
  // "booking meeting..." 提示。最后 done 仍渲文本。
  toolStartedNames: readonly string[];
};

export type SessionMode = 'public' | 'code' | 'byoai';

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

// PageSession —— ensureSession 之后内部记一份；含 pi-pivot 用的 part_ids
// + tool_specs。browser 不再 hit /sessions 多次 (老路径每次 ask 都
// reuseStored + 不读 part_ids)；这里 first-ask 拿一次然后整轮持有。
interface PageSession {
  sessionToken: string;
  conversationID: string;
  systemPromptPartIDs: readonly string[];
  toolSpecRegistry: ToolSpecRegistry;
  persona: string;
}

export function useConversation(deps: Deps): ConversationState {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PageSession | null>(null);
  const messageHistRef = useRef<Message[]>([]);
  const counter = useRef(0);

  const nextID = useCallback((): string => {
    counter.current += 1;
    return `t${counter.current}`;
  }, []);

  const ask = useCallback(async (text: string): Promise<void> => {
    const q = text.trim();
    if (q === '' || pending) return;
    await runAsk(q, deps, sessionRef, messageHistRef, setTurns, setPending, setError, nextID);
  }, [deps, pending, nextID]);

  const reset = useCallback((): void => {
    setTurns([]);
    setError(null);
    messageHistRef.current = [];
  }, []);

  return { turns, pending, error, ask, reset };
}

async function runAsk(
  q: string,
  deps: Deps,
  sessionRef: React.MutableRefObject<PageSession | null>,
  histRef: React.MutableRefObject<Message[]>,
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
    const byoai = await wrapBYOAIFor(deps, sess);
    const accum = makeAccumulator();
    await runAgentTurn(sess, byoai, histRef, q, makeObserver(id, accum, setTurns));
    finalizeTurn(id, accum, setTurns);
    bumpVisitorQuota();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setTurns((prev) => markFailed(prev, id, msg));
  } finally {
    setPending(false);
  }
}

// wrapBYOAIFor —— byoai mode 时从 vault 拿 plaintext key 用 HKDF(session_token)
// 派 AES key 信封过；其他 mode 返 undefined。
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

interface TurnAccumulator {
  body: string;
  citations: Citation[];
  seenCitedPaths: Set<string>;
  toolStartedNames: string[];
}

function makeAccumulator(): TurnAccumulator {
  return {
    body: '', citations: [], seenCitedPaths: new Set(),
    toolStartedNames: [],
  };
}

function makeObserver(
  turnID: string,
  accum: TurnAccumulator,
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>,
): EventObserver {
  return {
    onEvent(ev: AgentEvent): void {
      handleAgentEvent(ev, accum);
      setTurns((prev) => updateTurn(prev, turnID, accum, true));
    },
  };
}

function handleAgentEvent(ev: AgentEvent, accum: TurnAccumulator): void {
  if (ev.type === 'llm_chunk') {
    accum.body += ev.text;
    return;
  }
  if (ev.type === 'tool_started') {
    accum.toolStartedNames.push(ev.name);
    return;
  }
  if (ev.type === 'tool_completed') {
    pushCitationFromTool(ev.result, accum);
    return;
  }
  if (ev.type === 'capability_state_changed') {
    useCapabilityStore.getState().setStates(ev.states);
  }
}

function pushCitationFromTool(
  result: { name: string; result?: unknown; ok: boolean },
  accum: TurnAccumulator,
): void {
  if (!result.ok || result.name !== 'corpus_read') return;
  const r = pickCorpusReadShape(result.result);
  if (r === null) return;
  const path = r.path;
  if (accum.seenCitedPaths.has(path)) return;
  accum.seenCitedPaths.add(path);
  const kind: 'wiki' | 'output' = r.kind === 'output' ? 'output' : 'wiki';
  accum.citations.push({ kind, id: path, title: r.title });
}

function pickCorpusReadShape(raw: unknown): CorpusReadWire | null {
  if (!isRecord(raw)) return null;
  const path = readString(raw['path']);
  const kind = readString(raw['kind']);
  const title = readString(raw['title']) || path;
  return { path, kind, title };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

interface CorpusReadWire {
  path: string;
  kind: string;
  title: string;
}

function finalizeTurn(
  id: string, accum: TurnAccumulator,
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>,
): void {
  setTurns((prev) => updateTurn(prev, id, accum, false));
}

async function runAgentTurn(
  sess: PageSession,
  byoai: HttpBYOAIHeaders | undefined,
  histRef: React.MutableRefObject<Message[]>,
  userMessage: string,
  observer: EventObserver,
): Promise<void> {
  const agent = buildPageAgent(sess, byoai, observer);
  const next = await agent.send({
    userMessage, history: histRef.current,
  });
  histRef.current = [...next];
}

function buildPageAgent(
  sess: PageSession,
  byoai: HttpBYOAIHeaders | undefined,
  observer: EventObserver,
): VisitorAgent {
  return new VisitorAgent(
    {
      prompts: httpPromptSource({ baseURL: '' }),
      capabilities: zustandCapabilityStateSource(),
      llm: httpInferenceStreamer({
        baseURL: '', sessionToken: sess.sessionToken,
        byoai,
      }),
      tools: httpToolDispatcher({
        baseURL: '', sessionToken: sess.sessionToken,
        conversationID: sess.conversationID,
      }),
      observer,
    },
    {
      systemPromptPartIDs: assembledPartIDs(sess),
      toolSpecRegistry: sess.toolSpecRegistry,
    },
  );
}

// assembledPartIDs —— sess.systemPromptPartIDs + 一个 inline persona pseudo
// part 不需要 (persona 走 ComposeBasePersona 已经折进 visitor-header 之后)。
// 为了保持简单，pi-agent-core 拼 system 时直接拉所有 part_ids；persona
// 暂时通过 system_prompt_persona 字段（D-2 follow-up）由 caller 自己 prepend
// (这里就单纯返 partIDs)。
function assembledPartIDs(sess: PageSession): readonly string[] {
  return sess.systemPromptPartIDs;
}

function newPendingTurn(id: string, q: string): Turn {
  return {
    id, q, time: nowHM(), pending: true, answer: null,
    toolStartedNames: [],
  };
}

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
  ref: React.MutableRefObject<PageSession | null>,
  deps: Deps,
): Promise<PageSession> {
  if (ref.current !== null) return ref.current;
  const issued = await issueFresh(deps);
  const sess = toPageSession(issued);
  ref.current = sess;
  useCapabilityStore.getState().setStates(extractCapabilities(issued));
  return sess;
}

// IssuedSessionWithExtras —— sdk-core PublicSessionResponse 已含
// capabilities? / tool_specs? / system_prompt_part_ids?；这里 alias 一下
// 让本文件少 import。
type IssuedSessionWithExtras = PublicSessionResponse;

function toPageSession(issued: IssuedSessionWithExtras): PageSession {
  return {
    sessionToken: issued.session_token,
    conversationID: issued.conversation_id,
    systemPromptPartIDs: issued.system_prompt_part_ids ?? ['visitor-header'],
    toolSpecRegistry: makeRegistry(issued),
    persona: issued.system_prompt_persona ?? '',
  };
}

function extractCapabilities(issued: IssuedSessionWithExtras): readonly {
  id: string; enabled: boolean; quota_remaining?: number; policy_summary?: string;
}[] {
  return issued.capabilities ?? [];
}

function makeRegistry(issued: IssuedSessionWithExtras): ToolSpecRegistry {
  // backend 给的 tool_specs 是 flat list (跨多个 capability)；frontend
  // capability id → tool 关系不重要 (agent loop 只看 enabled cap →
  // 所有 enabled cap 的 tool union)，索引按 cap id 给个 fallback 兜底。
  const specs = (issued.tool_specs ?? []).map((s) => ({
    name: s.name, description: s.description, input_schema: s.input_schema,
  }));
  return {
    forCapability(_id: string) {
      // 单 cap 触发 → return all specs (LLM 看到全部可用工具)。多次 cap
      // walk 也只会 union 一份 (forCapability 多次回但 agent 内部已 dedupe
      // 凭 spec name)。简化优于精确分组。
      void _id;
      return specs;
    },
  };
}

async function issueFresh(deps: Deps): Promise<PublicSessionResponse> {
  const stored = loadStoredSession();
  return stored !== null
    ? reuseStored(stored)
    : await issueByMode(deps);
}

function reuseStored(stored: { session_token: string; conversation_id: string }): PublicSessionResponse {
  return {
    session_token: stored.session_token,
    conversation_id: stored.conversation_id,
  };
}

async function issueByMode(deps: Deps): Promise<PublicSessionResponse> {
  if (deps.mode === 'public') return issuePublicSession();
  if (deps.mode === 'code') return issueCodeSession({ code: '' });
  const meta = readBYOAIVaultMeta();
  return issueBYOAISession({ byoai_provider: meta?.provider ?? 'anthropic' });
}

function updateTurn(
  prev: Turn[], id: string, accum: TurnAccumulator, stillPending: boolean,
): Turn[] {
  return prev.map((t) => t.id === id ? withAnswer(t, accum, stillPending) : t);
}

function withAnswer(t: Turn, accum: TurnAccumulator, stillPending: boolean): Turn {
  return {
    ...t,
    pending: stillPending && accum.body === '',
    toolStartedNames: [...accum.toolStartedNames],
    answer: {
      paras: splitParas(accum.body),
      citations: accum.citations,
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
