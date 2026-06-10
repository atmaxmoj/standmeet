// use-chat —— visitor chat 的 UI 状态机：UI 吃 Dialog[] state，内部走
// VisitorTurnAgent + 真 prod adapters (H.10: agent loop 在 backend eino，
// 浏览器一次 POST /agent/turn，SSE 事件聚合成 Dialog)。
//
// ChatState 接口：caller (PageShell / FloatingChatDock / ChatRoom) 不变
// 拿 dialogs / pending / error + ask / reset。
//
// 命名 (G-1.5)：
//   - Turn → Dialog (一轮 visitor 问 + AI 答 + cited，跟 backend domain.Dialog 对齐)
//   - useConversation → useChat (Chat 是聚合根，dialog 是子 entity)
//   - Citation.kind → genre, Citation.id → path (后端复用 DocumentGenre，前端字段名说实话)
//
// 事件聚合:
//   - tool_completed corpus_read 事件 → cited 列表
//   - Dialog.answer.paras 仍由 body 拆段；body 从 llm_chunk text deltas 累积

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { loadStoredSession } from '@/lib/gate/use-gate';
import { restoreSession, revalidateSession, revalidateStored, splitParas } from '@/lib/page/use-chat-restore';
import { throbberLabel } from '@/lib/page/throbber-label';
import {
  ensureSession,
  type PageSession,
  type SessionMode as SessionModeT,
} from '@/lib/page/use-chat-session';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useCapabilityStore } from '@/lib/visitor/capability-store';
import { useAskVisitorStore } from '@/lib/visitor/ask-visitor-store';
import { useGhostsStore } from '@/lib/visitor/ghosts-store';

export type SessionMode = SessionModeT;

export type Citation = {
  genre: 'wiki' | 'output';
  // id —— entry 稳定标识,落 admin transcript 的 cited_*_ids 用它(不用 path
  // 反查,绕开树路径在 ACL 子集下对不上的坑)。path 只给 UI 显示。
  id: string;
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

// ToolThrobberView —— per-tool 进度行:name 给 `tool-throbber-<name>` testid,
// label 是已拼好的人话文案(throbber-label.ts)。
export type ToolThrobberView = {
  name: string;
  label: string;
};

export type Dialog = {
  id: string;
  q: string;
  time: string;
  pending: boolean;
  answer: DialogAnswer | null;
  // throbber = observer 对 agent 的**实时**观察:只持「当前」活动 —— 最近一次
  // tool_started,新 tool 来即替换,turn 落地清成 null。不是累积列表(那会堆一串
  // 又冻进 transcript);持久回执是下面的 toolCalls。label 由 throbber-label.ts
  // 按 name+args+backend progress_label 拼(corpus 读带 document)。
  currentTool: ToolThrobberView | null;
  // G-4: tool_completed 累到这里；UI 按 name 渲卡片 (corpus_search 卡 /
  // skill_*/ext_* generic dump)。corpus_read 的 result 走 Citation 不重复。
  toolCalls: readonly ToolCallView[];
  // retrying —— backend transport 正在重试一次 transient LLM 失败;throbber
  // 显 "retrying" 而非 "retrieving"。下一条 text/tool 进度事件自然清掉。
  retrying: boolean;
  // failed —— 这一轮没答成(error 兜底 / 掐断)。strip 的 used 计数把它排除:
  // 答完的轮才算(count = 数 dialogs 里 !pending && !failed 的)。
  failed: boolean;
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

  // H.13.d: mount 时若 localStorage 已有 stored session (返回 visitor /
  // ?code= 已被 useAbsorbCodeFromURL 持久化)，把 ghosts 种
  // 进 ghost 队列；ensureSession 在 ask 时才跑，初始 chat 屏要 ghost 看
  // 得见就靠这一勺。
  useEffect(() => {
    const stored = loadStoredSession();
    useGhostsStore.getState().seed(stored?.ghosts ?? []);
    // 刷新恢复:有 stored session 就按 token 拉回这段对话的 Q&A 重建 transcript
    // (纯内存 dialogs 刷新会空,这里补回来)。失败 → 空,跟现在一样不崩。
    const token = stored?.session_token ?? '';
    const conv = stored?.conversation_id ?? '';
    if (token !== '' && conv !== '') void restoreSession(conv, token, setDialogs);
  }, []);

  // strip 的 used 派生自 dialogs(答完的轮 = !pending && !failed),不是独立自增的
  // 计数器 —— conversation 是唯一源,没有「乐观 +1 被迟到快照盖回去」那种 race。
  const used = dialogs.filter((d) => !d.pending && !d.failed).length;
  useEffect(() => { useVisitorSessionStore.getState().setUsed(used); }, [used]);

  // 换人:SessionStrip 点名字重开 picker → 发新名字 issue 出新 session(新
  // member / 新对话),session store 的 startedAt 随之变。chat 据此丢掉旧
  // transcript + 缓存的 session,下一问从新 stored session 起。新 session 的
  // ghosts 已由 issue 重新 seed,这里不碰 ghosts。
  const startedAt = useVisitorSessionStore((s) => s.session?.startedAt ?? 0);
  const lastStartedAt = useRef(startedAt);
  useEffect(() => {
    if (lastStartedAt.current !== 0 && startedAt !== lastStartedAt.current) {
      sessionRef.current = null;
      setDialogs([]);
      setError(null);
      messageHistRef.current = [];
      useAskVisitorStore.getState().clear();
    }
    lastStartedAt.current = startedAt;
  }, [startedAt]);

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
    // H.13.d: 新 chat session 重新接 ghost；不 clear 会把上一段 follow-up
    // 队列带过来。
    useGhostsStore.getState().clear();
    // I.1: 老 dialog 里的 ask_visitor lock 状态也不该跨 session。
    useAskVisitorStore.getState().clear();
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
    // backend 拥有这一轮:/agent/turn 流末端已把它 sink 进 conversation 表(#28),
    // 前端不再自落库。答完那条留在本地 transcript 显示,used 由 dialogs 派生(下面
    // mirror effect)自然 +1;真相在后端,刷新走 restoreSession 从 conversation 重建。
    // 失败/掐断(含 401)→ revalidate 收口:会话若死了清身份回入口。
    if (!turnSucceeded(accum)) void revalidateSession(sess.conversationID, sess.sessionToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setDialogs((prev) => markFailed(prev, id, msg));
    void revalidateStored();
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
  seenCitedIDs: Set<string>;
  // currentTool —— 当前 throbber 活动(最近一次 tool_started);toolSeq 是单调
  // 计数,只为 corpus_read 的动词轮换(reading / pulling up / ...)留个稳定 idx。
  currentTool: ToolThrobberView | null;
  toolSeq: number;
  toolCalls: ToolCallView[];
  retrying: boolean;
  // errorMsg —— backend 出 `error` 事件(含 stream-cut 兜底)时的人话消息;
  // 非空 → dialog 收尾渲成回答段落,而不是空白。
  errorMsg: string;
}

function makeAccumulator(): DialogAccumulator {
  return {
    body: '', citations: [], seenCitedIDs: new Set(),
    currentTool: null, toolSeq: 0, toolCalls: [], retrying: false, errorMsg: '',
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
    // 答案开始流出 → 清 throbber 让位给答案(throbber 从 tool_started 撑到这里)。
    accum.currentTool = null;
    accum.retrying = false; // 进度恢复
    return;
  }
  if (ev.type === 'tool_started') {
    // 替换,不累积:throbber 永远只反映 agent 此刻在跑的那个 tool。
    accum.currentTool = {
      name: ev.name,
      label: throbberLabel(ev.name, ev.args, ev.progressLabel, accum.toolSeq),
    };
    accum.toolSeq += 1;
    accum.retrying = false;
    return;
  }
  if (ev.type === 'tool_completed') {
    accum.toolCalls.push({
      name: ev.result.name, ok: ev.result.ok, result: ev.result.result,
    });
    pushCitationFromTool(ev.result, accum);
    // 不在 tool_completed 清 throbber:保留到 llm_chunk(答案开始)才清,让
    // "reading X" 撑过「读完→LLM 组织答案」那段(DeepSeek 几十秒的大头),否则
    // 工具往返一瞬就没了、根本看不见。tool 之间 currentTool 由下一个 tool_started
    // 替换;首个 tool 之前是 null → thinking 词。
    accum.retrying = false;
    return;
  }
  if (ev.type === 'retrying') {
    // backend 在重试一次 transient LLM 失败 → throbber 显 "retrying"。
    accum.retrying = true;
    return;
  }
  if (ev.type === 'error') {
    // backend `error` 事件(含前端 stream-cut 兜底):人话消息收尾渲出来,
    // 不让对话空白。clear retrying。
    accum.errorMsg = ev.message;
    accum.retrying = false;
    return;
  }
  if (ev.type === 'capability_state_changed') {
    useCapabilityStore.getState().setStates(ev.states);
    return;
  }
  if (ev.type === 'ghosts_received') {
    // H.13.d: code-accessor 收到 backend agent_turn 末尾的 follow-up
    // 3 条，append 到 ghost 队列尾巴；非 code visitor backend 不发，
    // 这里 dead branch。
    useGhostsStore.getState().append(ev.items);
  }
}

function pushCitationFromTool(
  result: { name: string; result?: unknown; ok: boolean },
  accum: DialogAccumulator,
): void {
  if (!result.ok || result.name !== 'corpus_read') return;
  const r = pickCorpusReadShape(result.result);
  if (r === null) return;
  // 按 id 去重 + 落库:同一 entry 读多次只引一次。
  if (r.id === '' || accum.seenCitedIDs.has(r.id)) return;
  accum.seenCitedIDs.add(r.id);
  const genre: 'wiki' | 'output' = r.genre === 'output' ? 'output' : 'wiki';
  accum.citations.push({ genre, id: r.id, path: r.path, title: r.title, body: r.body });
}

function pickCorpusReadShape(raw: unknown): CorpusReadWire | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw['id']);
  const path = readString(raw['path']);
  const genre = readString(raw['genre']);
  const title = readString(raw['title']) || path;
  const body = readString(raw['body']);
  return { id, path, genre, title, body };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

interface CorpusReadWire {
  id: string;
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
    currentTool: null, toolCalls: [], retrying: false, failed: false,
  };
}

// turnSucceeded —— 这一 turn 算不算"成功回复":拿到非空回答且没走 error 兜底。
// 决定要不要消耗配额(只有成功才 record + bump)。
function turnSucceeded(accum: DialogAccumulator): boolean {
  return accum.errorMsg === '' && accum.body !== '';
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
    // error / answer 已有内容 → 不再 pending;retrying 期间 body 空仍 pending。
    pending: stillPending && accum.body === '' && accum.errorMsg === '',
    retrying: stillPending && accum.retrying,
    // throbber 是 observer 对 agent 的**实时**观察:observer 还在收事件
    // (stillPending)时反映当前工具;turn 一落地(finalize,stillPending=false)
    // 就清成 null —— agent 不动了就没什么可观察的。持久回执是下面的 toolCalls
    // (tool_completed),不靠这个。
    currentTool: stillPending ? accum.currentTool : null,
    toolCalls: [...accum.toolCalls],
    // error 兜底(errorMsg 非空)= 这轮没答成,不计数。
    failed: accum.errorMsg !== '',
    answer: accum.errorMsg !== '' ? noticeAnswer(accum.errorMsg) : {
      paras: splitParas(accum.body),
      citations: accum.citations,
      private: false,
      byoaiBlocked: false,
    },
  };
}

// noticeAnswer —— backend error 事件的人话消息当普通段落渲(已经是友好文案,
// 不加 "error:" 前缀)。markFailed 的 throw 路径仍走 errorAnswer 带前缀。
function noticeAnswer(msg: string): DialogAnswer {
  return { paras: [msg], citations: [], private: false, byoaiBlocked: false };
}

function markFailed(prev: Dialog[], id: string, msg: string): Dialog[] {
  return prev.map((d) =>
    d.id === id ? { ...d, pending: false, retrying: false, failed: true, answer: errorAnswer(msg) } : d);
}

function errorAnswer(msg: string): DialogAnswer {
  return { paras: [`error: ${msg}`], citations: [], private: false, byoaiBlocked: false };
}
