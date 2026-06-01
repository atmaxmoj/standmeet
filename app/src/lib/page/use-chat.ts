// use-chat —— D 期切到 pi-agent-core (在 browser 里跑 LLM ↔ tool loop)，
// UI 吃 Dialog[] state，内部走 useAgent + 真 prod adapters。
//
// ChatState 接口：caller (PageShell / FloatingChatDock / ChatRoom) 不变
// 拿 dialogs / pending / error + ask / reset。
//
// 命名 (G-1.5)：
//   - Turn → Dialog (一轮 visitor 问 + AI 答 + cited，跟 backend domain.Dialog 对齐)
//   - useConversation → useChat (Chat 是聚合根，dialog 是子 entity)
//   - Citation.kind → genre, Citation.id → path (后端复用 DocumentGenre，前端字段名说实话)
//
// 改动史:
//   - 老 streamChatMessage(/messages SSE token-by-token) → useAgent.send()
//     (browser-side loop, /inference/stream + /sessions/{id}/tools/{name})
//   - 老 SSE done.cited_wiki_refs → tool_completed corpus_read 事件聚合
//   - Dialog.answer.paras 仍由 body 拆段；body 从 llm_chunk text deltas 累积

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
import { recordDialog } from '@/lib/page/dialog';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import {
  useCapabilityStore, zustandCapabilityStateSource,
} from '@/lib/visitor/capability-store';

export type Citation = {
  genre: 'wiki' | 'output';
  path: string;
  title: string;
};

export type DialogAnswer = {
  paras: string[];
  citations: readonly Citation[];
  private: boolean;
  byoaiBlocked: boolean;
};

export type Dialog = {
  id: string;
  q: string;
  time: string;
  pending: boolean;
  answer: DialogAnswer | null;
  // D-5: per-tool throbber 序列。agent-core 跑每个 tool 时 tool_started
  // → name 入这个列表，ConversationDeck 渲一条 "searching corpus..." /
  // "booking meeting..." 提示。最后 done 仍渲文本。
  toolStartedNames: readonly string[];
};

export type SessionMode = 'public' | 'code' | 'byoai';

export type ChatState = {
  dialogs: Dialog[];
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

export function useChat(deps: Deps): ChatState {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PageSession | null>(null);
  const messageHistRef = useRef<Message[]>([]);
  const counter = useRef(0);

  const nextID = useCallback((): string => {
    counter.current += 1;
    return `d${counter.current}`;
  }, []);

  const ask = useCallback(async (text: string): Promise<void> => {
    const q = text.trim();
    if (q === '' || pending) return;
    await runAsk(q, deps, sessionRef, messageHistRef, setDialogs, setPending, setError, nextID);
  }, [deps, pending, nextID]);

  const reset = useCallback((): void => {
    setDialogs([]);
    setError(null);
    messageHistRef.current = [];
  }, []);

  return { dialogs, pending, error, ask, reset };
}

async function runAsk(
  q: string,
  deps: Deps,
  sessionRef: React.MutableRefObject<PageSession | null>,
  histRef: React.MutableRefObject<Message[]>,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
  setPending: (b: boolean) => void,
  setError: (e: string | null) => void,
  nextID: () => string,
): Promise<void> {
  const id = nextID();
  setError(null);
  setPending(true);
  setDialogs((prev) => [...prev, newPendingDialog(id, q)]);
  try {
    const sess = await ensureSession(sessionRef, deps);
    const byoai = await wrapBYOAIFor(deps, sess);
    const accum = makeAccumulator();
    await runAgentForDialog(sess, byoai, histRef, q, makeObserver(id, accum, setDialogs));
    finalizeDialog(id, accum, setDialogs);
    void recordDialog(sess, q, { body: accum.body, citations: accum.citations });
    bumpVisitorQuota();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setDialogs((prev) => markFailed(prev, id, msg));
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

interface DialogAccumulator {
  body: string;
  citations: Citation[];
  seenCitedPaths: Set<string>;
  toolStartedNames: string[];
}

function makeAccumulator(): DialogAccumulator {
  return {
    body: '', citations: [], seenCitedPaths: new Set(),
    toolStartedNames: [],
  };
}

function makeObserver(
  dialogID: string,
  accum: DialogAccumulator,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
): EventObserver {
  return {
    onEvent(ev: AgentEvent): void {
      handleAgentEvent(ev, accum);
      setDialogs((prev) => updateDialog(prev, dialogID, accum, true));
    },
  };
}

function handleAgentEvent(ev: AgentEvent, accum: DialogAccumulator): void {
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
  accum: DialogAccumulator,
): void {
  if (!result.ok || result.name !== 'corpus_read') return;
  const r = pickCorpusReadShape(result.result);
  if (r === null) return;
  const path = r.path;
  if (accum.seenCitedPaths.has(path)) return;
  accum.seenCitedPaths.add(path);
  const genre: 'wiki' | 'output' = r.genre === 'output' ? 'output' : 'wiki';
  accum.citations.push({ genre, path, title: r.title });
}

function pickCorpusReadShape(raw: unknown): CorpusReadWire | null {
  if (!isRecord(raw)) return null;
  const path = readString(raw['path']);
  // backend 当前 wire 字段叫 kind (G-1.5 阶段没动 backend tool result wire)；
  // 这里读 kind 但内部用 genre 概念。后续 wire 改 genre 时只需删 fallback。
  const genre = readString(raw['genre']) || readString(raw['kind']);
  const title = readString(raw['title']) || path;
  return { path, genre, title };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

interface CorpusReadWire {
  path: string;
  genre: string;
  title: string;
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

function assembledPartIDs(sess: PageSession): readonly string[] {
  return sess.systemPromptPartIDs;
}

function newPendingDialog(id: string, q: string): Dialog {
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
  const specs = (issued.tool_specs ?? []).map((s) => ({
    name: s.name, description: s.description, input_schema: s.input_schema,
  }));
  return {
    forCapability(_id: string) {
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

// reuseStored —— rebuild PublicSessionResponse from the persisted blob.
// G-1 fix: persist + restore capabilities + tool_specs (D-5 lost them).
type StoredFull = Pick<PublicSessionResponse,
  'session_token' | 'conversation_id' | 'capabilities' | 'tool_specs' |
  'system_prompt_part_ids' | 'system_prompt_persona'>;

function reuseStored(stored: StoredFull): PublicSessionResponse {
  return {
    session_token: stored.session_token,
    conversation_id: stored.conversation_id,
    capabilities: stored.capabilities,
    tool_specs: stored.tool_specs,
    system_prompt_part_ids: stored.system_prompt_part_ids,
    system_prompt_persona: stored.system_prompt_persona,
  };
}

async function issueByMode(deps: Deps): Promise<PublicSessionResponse> {
  if (deps.mode === 'public') return issuePublicSession();
  if (deps.mode === 'code') return issueCodeSession({ code: '' });
  const meta = readBYOAIVaultMeta();
  return issueBYOAISession({ byoai_provider: meta?.provider ?? 'anthropic' });
}

function updateDialog(
  prev: Dialog[], id: string, accum: DialogAccumulator, stillPending: boolean,
): Dialog[] {
  return prev.map((d) => d.id === id ? withAnswer(d, accum, stillPending) : d);
}

function withAnswer(d: Dialog, accum: DialogAccumulator, stillPending: boolean): Dialog {
  return {
    ...d,
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

function markFailed(prev: Dialog[], id: string, msg: string): Dialog[] {
  return prev.map((d) => d.id === id ? { ...d, pending: false, answer: errorAnswer(msg) } : d);
}

function errorAnswer(msg: string): DialogAnswer {
  return { paras: [`error: ${msg}`], citations: [], private: false, byoaiBlocked: false };
}
