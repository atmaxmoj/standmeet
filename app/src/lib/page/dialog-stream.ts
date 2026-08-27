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
  // slug —— writings 才有,**给链接用**(`corpusHref`)。path 那一栏是给人看的位置,
  // 不是地址:writings 在公开站上按 slug 寻址,拿 path 去拼会 404。
  slug: string;
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
  // notice —— 这一轮**没有正常收尾**时说给访客的那句话,挂在已经流出来的内容旁边。
  // 分成独立一格而不是塞进 paras:一段被截断的文字和「它被截断了」是两件事,合在一起
  // 读起来就像作者自己那么写的(F-A-32)。空 = 这一轮正常结束。
  notice?: string;
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
  // stopReason —— 这一轮**为什么**停（done 帧原样带来的那个值）。
  //
  // 存的是原值而不是一个 `truncated: boolean`（UX-84）：布尔只能回答「是不是没说完」，
  // 而访客要知道的是**哪一种墙** —— 输出预算用完和一路调工具调到墙，对他意味着不同的下一步。
  // 收窄成布尔的那一刻，「每种撞墙写自己的原因」这件事就已经做不到了
  // （同 [[empty-is-not-json-null]]：把区别抹平在入口，下游再想分就没有依据）。
  //
  // `end_turn` = 正常说完；其余值查 STOP_NOTICE，查不到就不显示提示。
  stopReason: string;
  // claimUnbacked —— 这一轮的答案说它办成了一件事，而本轮**没有那件事的回执**（done 帧的
  // stop_reason=claim_unbacked）。判定在后端，因为只有它知道这一轮调过哪些工具、回执成没成。
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
  if (ev.type === 'turn_finished') {
    // 收场原因**原样留下**。这个值一路从 provider 经后端 sink.Done 传到浏览器，
    // 以前在 SSE 解析完就被扔了 —— 于是没人知道这一段是收尾了还是被截断（F-A-34）；
    // 后来我把它收成一个 `truncated` 布尔，那又把「哪一种墙」抹掉了（UX-84）。
    // 存原值，由 STOP_NOTICE 决定说什么。
    accum.stopReason = ev.stopReason;
    // claim_unbacked 不是模型给的收场，是**产品判的**：这一轮说它办成了一件事，而本轮没有
    // 那件事的回执（F-A-37）。
    accum.claimUnbacked = ev.stopReason === 'claim_unbacked';
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
    // answer 始终在场:一个字都没流出来 → 只渲那句人话;已经流出来了一部分 → **两样都留**
    // (残缺的正文 + 引用 + 一句「它没说完」);正常则散文 + 引用。toolCalls 一律带上
    // (跑过的卡片即使最终报错也该留着)。
    answer: answerFor(accum),
  };
}

// answerFor —— 见 withAnswer。拆出来让 withAnswer 的分支保持可读。
//
// F-A-32:以前这里是「有 errorMsg 就整段换成那句话」,于是一次跑了 47 次读、攒了 43 条引用
// 的turn 一旦没收尾,访客眼前的东西会**全部消失**,只剩一句「连接断了」。反过来同样糟:什么都
// 不说的话,半截的计划旁白就冒充成了答案。两样都留才对。
// TRUNCATED_NOTICE —— 输出预算用完时挂在答案下面的那句话。
//
// **这句话的措辞和形状不是这里发明的**（UX-84）：它跟「这场问完了」是同一类事情 ——
// 一次配额到头，产品停下来告诉访客。50/50 之后那一侧说的是 `session full`
// （`ChatRoom.tsx` 的 `ComposerAction`，朱红等宽小写），所以这一侧说 `turn full`，
// 同一个词根、同一套字。**一件事一种说法**：我原来在这里自造了一句
// 「this answer was cut short — ask for the rest, or narrow the question」，
// 那既没设计过，还多许了一个「rest」——`answer_chars=0` 的时候根本没有 rest。
//
// 走的是 F-A-32 建的同一个 notice 槽（残缺正文 + 引用 + 一句人话都留着）。
// STOP_NOTICE —— **每一种撞墙自己写自己的原因**（UX-84）。
//
// 不写死一句：撞墙不止一种，而「为什么停」正是访客唯一想知道的事。写死一句的话，
// 下一种停法出现时只会沿用上一种的说法 —— 那正是这条缺陷的来历（我原来给
// `stop_reason=max_tokens` 写了一句「ask for the rest」，而 `answer_chars=0` 时没有 rest）。
//
// 词根跟隔壁那个到头态对齐（`ChatRoom.tsx` 的 `SESSION FULL`）：一次配额到头就是
// `… FULL`，其余各说各的。后端加一种停法 → 这里加一行；**没登记的停法不显示提示**
// （宁可不说，也不要拿别人的理由顶上）。
//
// 后端那侧的对应物是 `normalizedStop`（proxy_wire.go）：产品自己判出来的原样透传，
// 上游的走归一化。两边加的是同一件事的两半。
const STOP_NOTICE: Readonly<Record<string, string>> = {
  // 模型的输出预算用完，**正文在、只是没说完** —— 跟「这场问完了」同一类，一次配额到头。
  max_tokens: 'turn full · output budget',
  // 一直在调工具、到墙为止，正文在（F-A-35 的第一个现场是它的空答案版本）。
  tool_use: 'turn full · spent on lookups',
  // **一个字都没答出来，也救不回来**（后端 `doneStop` 判的，F-A-35）。
  //
  // 措辞跟上面两条**不同**是有意的：那两条说「没说完」，可以问「剩下的呢」；这一条说
  // 「什么都没有」，唯一有用的下一步是把问题缩小。以前这一类跟它们共用一句
  // 「ask for the rest」—— 在没有 rest 的时候许诺了一个 rest。
  no_answer: 'no answer this turn · try a narrower question',
  // **时间用完了**，而且边界那次救场也没来得及（F-A-44）。真实环境里的样子：读了 64 条笔记，
  // 六分钟后访客读到 *"The connection dropped before a reply came back. Please try asking
  // again."* —— 连接好好的，撞的是时间墙，而「再问一次」会撞同一堵墙。
  //
  // 措辞跟 `no_answer` 分开：那一条是「什么都没找到」，这一条是「找到了很多、没来得及拼起来」，
  // 而屏幕上那行 `SEARCHED n · READ m` 还在，访客看得见它到底做了多少。
  deadline: 'out of time · it read a lot and couldn’t finish · ask about one piece of it',
};

// UNBACKED_CLAIM_NOTICE —— 上面那段话说它替你办成了一件事，而这一轮**没有那件事的回执**
// （F-A-37：真实环境里 "Booked. ✅ … Invite went to …" 那一轮一个工具都没调，日历上什么都
// 没有）。已经流出去的字收不回来，所以产品在旁边把话说清楚：**别照着它安排你的时间**。
// 判定在后端（done 帧的 stop_reason=claim_unbacked），这里只负责说人话。
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

// noticeFor —— 这一轮要不要在答案旁边挂一句产品自己的话。**无据的主张排在截断前面**：
// 一段没说完的话让人再问一次，一句没发生的承诺让人白等一场会。
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
