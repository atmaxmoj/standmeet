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
  // id —— entry 稳定标识,落 admin transcript 的 cited_*_ids 用它(不用 path
  // 反查,绕开树路径在 ACL 子集下对不上的坑)。path 只给 UI 显示。
  id: string;
  path: string;
  title: string;
  // G-3: corpus_read 已经把 body 拿到手；存进 citation 让 UI 点击直接展
  // 开原文，免一次额外后端 fetch (+ 二次 ACL 评估)。
  body: string;
};

// Answer —— assistant 这一轮的全部产出:散文段落 + 引用 + 它调的工具。访客只
// 产生 q;tool call 永远是 assistant 发起的,所以 toolCalls 属于 Answer。ACL /
// 切片在检索层就锁死了(agent 读不到范围外的东西),不存在"生成完再标 private"
// 这一步,所以这里没有 private/byoaiBlocked 标志。
export type Answer = {
  paras: string[];
  citations: readonly Citation[];
  toolCalls: readonly ToolCallView[];
};

// ToolCallView —— G-4: tool_completed 累到 Dialog；UI 按 name dispatch
// 渲染 (corpus_search hits / calendar_book confirmation / generic JSON
// dump for skill_* / ext_*)。result 是 raw unknown，渲染层自己 narrow。
//
// result 是 **optional**:检索族(corpus_*)的结果根本不下发给访客(F-A-28,里面是笔记正文),
// 直播那一路给空串、刷新恢复那一路整格不给。界面对这些调用也只数个数、不渲正文,所以"没有
// result"是这条通道的**常态**,不是异常。写成必填会让类型撒谎,而那个谎正是恢复整段挂掉的地方。
export type ToolCallView = {
  name: string;
  ok: boolean;
  result?: unknown;
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
  // answer 始终在场(开局空对象);流式期间 paras/toolCalls 往里加,pending 表示
  // 还没收尾。toolCalls 在 answer 里(assistant 产出),不再是 Dialog 顶层字段。
  answer: Answer;
  // throbber = observer 对 agent 的**实时**观察:只持「当前」活动 —— 最近一次
  // tool_started,新 tool 来即替换,turn 落地清成 null。纯 UI 瞬态,不持久
  // (持久回执是 answer.toolCalls)。label 由 throbber-label.ts 拼。
  currentTool: ToolThrobberView | null;
  // retrying —— backend transport 正在重试一次 transient LLM 失败;throbber
  // 显 "retrying" 而非 "retrieving"。下一条 text/tool 进度事件自然清掉。
  retrying: boolean;
  // failed —— 这一轮没答成(error 兜底 / 掐断)。strip 的 used 计数把它排除:
  // 答完的轮才算(count = 数 dialogs 里 !pending && !failed 的)。
  failed: boolean;
};


export interface DialogAccumulator {
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
  // ghostReceived —— 这一 turn 是否收到过 `ghost_received` 帧。F-A-9:policy 沉默(没帧)的 turn
  // 收尾时要**清掉**上一条 ghost,否则输入框会一直挂着已访问 waypoint 的陈旧 ghost。
  ghostReceived: boolean;
}

export function makeAccumulator(): DialogAccumulator {
  return {
    body: '', citations: [], seenCitedIDs: new Set(),
    currentTool: null, toolSeq: 0, toolCalls: [], retrying: false, errorMsg: '',
    ghostReceived: false,
  };
}


export function handleAgentEvent(ev: AgentEvent, accum: DialogAccumulator): void {
  if (ev.type === 'llm_chunk') {
    accum.body += ev.text;
    // 答案开始流出 → 清 throbber 让位给答案(throbber 从 tool_started 撑到这里)。
    accum.currentTool = null;
    accum.retrying = false; // 进度恢复
    return;
  }
  if (ev.type === 'tool_started') {
    // F-A-4 P1 — a tool_started proves the text streamed so far this round was the model
    // narrating its plan: process, not the answer. Fold it out of the answer body (matches
    // what the backend persists, 122e922); the throbber takes over as the activity indicator.
    accum.body = '';
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
    logger.info('chat tool_completed', { name: ev.result.name, ok: ev.result.ok });
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
  if (ev.type === 'ghost_received') {
    // Ghost P4: code-accessor 答完一轮，backend policy 出**单条** steering ghost；
    // 把输入框 ghost 换成这条（非 code visitor backend 不发，这里 dead branch）。
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
  // 按 id 去重 + 落库:同一 entry 读多次只引一次。
  if (r.id === '' || accum.seenCitedIDs.has(r.id)) return;
  accum.seenCitedIDs.add(r.id);
  accum.citations.push({ genre: r.genre, id: r.id, path: r.path, title: r.title, body: r.body });
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

// turnSucceeded —— 这一 turn 算不算"成功回复":拿到非空回答且没走 error 兜底。
// 决定要不要消耗配额(只有成功才 record + bump)。
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
    // error / answer 已有内容 → 不再 pending;retrying 期间 body 空仍 pending。
    pending: stillPending && accum.body === '' && accum.errorMsg === '',
    retrying: stillPending && accum.retrying,
    // throbber 是 observer 对 agent 的**实时**观察:observer 还在收事件
    // (stillPending)时反映当前工具;turn 一落地(finalize,stillPending=false)
    // 就清成 null —— agent 不动了就没什么可观察的。持久回执是下面的 toolCalls
    // (tool_completed),不靠这个。
    currentTool: stillPending ? accum.currentTool : null,
    // error 兜底(errorMsg 非空)= 这轮没答成,不计数。
    failed: accum.errorMsg !== '',
    // answer 始终在场:错误兜底渲成友好段落,正常则散文 + 引用;toolCalls 一律带上
    // (跑过的卡片即使最终报错也该留着)。
    answer: accum.errorMsg !== ''
      ? noticeAnswer(accum.errorMsg, accum.toolCalls)
      : { paras: splitParas(accum.body), citations: accum.citations, toolCalls: [...accum.toolCalls] },
  };
}

// noticeAnswer —— backend error 事件的人话消息当普通段落渲(已经是友好文案,
// 不加 "error:" 前缀)。markFailed 的 throw 路径仍走 errorAnswer 带前缀。
function noticeAnswer(msg: string, toolCalls: readonly ToolCallView[]): Answer {
  return { paras: [msg], citations: [], toolCalls: [...toolCalls] };
}

export function markFailed(prev: Dialog[], id: string, msg: string): Dialog[] {
  return prev.map((d) =>
    d.id === id ? { ...d, pending: false, retrying: false, failed: true, answer: errorAnswer(msg) } : d);
}

function errorAnswer(msg: string): Answer {
  return { paras: [`error: ${msg}`], citations: [], toolCalls: [] };
}

// splitParas —— body 文本按空行拆段(dialog 渲染用;restore 重建历史也用它)。
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
