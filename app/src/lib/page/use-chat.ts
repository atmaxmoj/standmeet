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
import { VisitorTurnAgent } from '@standmeet/agent-core';
import type {
  AgentEvent, EventObserver, Message,
} from '@standmeet/agent-core';
import {
  httpPromptSource, httpAgentTurnStreamer,
  type HttpBYOAIHeaders,
} from '@standmeet/sdk';

import { wrapBYOAIKey } from '@/lib/gate/byoai-envelope';
import { readBYOAICredFull } from '@/lib/gate/byoai-vault';
import { recordDialog } from '@/lib/page/dialog';
import {
  ensureSession,
  type PageSession,
  type SessionMode as SessionModeT,
} from '@/lib/page/use-chat-session';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useCapabilityStore } from '@/lib/visitor/capability-store';

export type SessionMode = SessionModeT;

export type Citation = {
  genre: 'wiki' | 'output';
  path: string;
  title: string;
  // G-3: corpus_read 已经把 body 拿到手；存进 citation 让 UI 点击直接展
  // 开原文，免一次额外后端 fetch (+ 二次 ACL 评估)。
  body: string;
};

export type DialogAnswer = {
  paras: string[];
  citations: readonly Citation[];
  private: boolean;
  byoaiBlocked: boolean;
};

// ToolCallView —— G-4: tool_completed 累到 Dialog；UI 按 name dispatch
// 渲染 (corpus_search hits / calendar_book confirmation / generic JSON
// dump for skill_* / ext_*)。result 是 raw unknown，渲染层自己 narrow。
export type ToolCallView = {
  name: string;
  ok: boolean;
  result: unknown;
};

export type Dialog = {
  id: string;
  q: string;
  time: string;
  pending: boolean;
  answer: DialogAnswer | null;
  // D-5: per-tool throbber 序列。agent-core 跑每个 tool 时 tool_started →
  // name 入这个列表；ConversationDeck / ChatRoom 渲一条 throbber，label
  // 走 useThrobberLabel 从 backend ToolSpec.progress_label 拉 (G-8)。
  toolStartedNames: readonly string[];
  // G-4: tool_completed 累到这里；UI 按 name 渲卡片 (corpus_search 卡 /
  // skill_*/ext_* generic dump)。corpus_read 的 result 走 Citation 不重复。
  toolCalls: readonly ToolCallView[];
};

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
  toolCalls: ToolCallView[];
}

function makeAccumulator(): DialogAccumulator {
  return {
    body: '', citations: [], seenCitedPaths: new Set(),
    toolStartedNames: [], toolCalls: [],
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
    accum.toolCalls.push({
      name: ev.result.name, ok: ev.result.ok, result: ev.result.result,
    });
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
  accum.citations.push({ genre, path, title: r.title, body: r.body });
}

function pickCorpusReadShape(raw: unknown): CorpusReadWire | null {
  if (!isRecord(raw)) return null;
  const path = readString(raw['path']);
  const genre = readString(raw['genre']);
  const title = readString(raw['title']) || path;
  const body = readString(raw['body']);
  return { path, genre, title, body };
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
  body: string;
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
): VisitorTurnAgent {
  // H.10: backend (eino ADK) 接管 agent loop；浏览器只调一次 /agent/turn
  // 收 SSE 事件。不再需要 capabilities / llm / tools 三个 port，整套
  // loop / dispatch 全在 backend。
  return new VisitorTurnAgent(
    {
      prompts: httpPromptSource({ baseURL: '' }),
      turn: httpAgentTurnStreamer({
        baseURL: '', sessionToken: sess.sessionToken, byoai,
      }),
      observer,
    },
    {
      systemPromptPartIDs: assembledPartIDs(sess),
      conversationID: sess.conversationID,
    },
  );
}

function assembledPartIDs(sess: PageSession): readonly string[] {
  return sess.systemPromptPartIDs;
}

function newPendingDialog(id: string, q: string): Dialog {
  return {
    id, q, time: nowHM(), pending: true, answer: null,
    toolStartedNames: [], toolCalls: [],
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
    toolCalls: [...accum.toolCalls],
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
