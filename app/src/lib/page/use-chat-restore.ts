// use-chat-restore —— 载入恢复 + reconcile。凭 conversation id + token 拉后端
// 会话聚合(GET /sessions/<conv>):
//   - 重建 transcript(历史 Q&A,带引用)
//   - 把 strip 的 used / max / 名额 / 名字 按后端权威值纠回(后端 conversation +
//     code 是唯一 source of truth)
//   - token 已失效(401)→ 清掉旧身份,按有没有 code 回入口流程
//
// 竞态防护:聚合是 mount 时刻发的异步请求,resolve 可能晚于用户随手问的一轮。
// 那一轮本地把 used +1、往 transcript 塞了新对话,迟到的旧聚合不能盖回去 ——
// used 只在 fetch 期间没被本地动过时才采纳;transcript 只在当前为空时才重建。
//
// splitParas 也搬这儿(use-chat 的 withAnswer 也用,反过来 import)。

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

// seedEphemeralStores —— 开局(mount/刷新)把 stored blob 的临时投影补回各 store：
// ghosts / tool_specs(含 per-tool ui_html) / dock 按钮 / capabilities。ensureSession 是
// lazy(只在发问时跑)，不补这一勺初始 chat 屏这些就空(按钮渲不出、外置卡渲不出)。返回
// stored 供 caller 拉 token/conv 重建 transcript。
export function seedEphemeralStores(): ReturnType<typeof loadStoredSession> {
  const stored = loadStoredSession();
  useGhostsStore.getState().seed(stored?.ghosts ?? []);
  useToolSpecsStore.getState().setSpecs(stored?.tool_specs ?? []);
  useDockButtonsStore.getState().setButtons(stored?.dock_buttons ?? []);
  useCapabilityStore.getState().setStates(stored?.capabilities ?? []);
  return stored;
}


// restoreSession —— 载入时拉会话:活着 → reconcile + 重建 transcript;失效 →
// 清身份回入口;抖动(error)→ 保持现状不崩。
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

// historyFrom —— 把取回来的逐字稿折回**模型看的那串消息**（F-A-46）。
//
// 为什么必须有：这段对话是客户端驱动的，每一轮把手里那串消息当 History 发出去。刷新之后
// 逐字稿是重建的（`applyView`），而那串消息**是空的** —— 于是屏幕上明明还写着刚才问过什么，
// 模型却一个字都看不见，访客的下一句追问落在真空里。
//
// 只折 Q/A + 事件：引用、tool 卡这些是**呈现**，模型那一侧本来就靠工具结果自己拿；
// 而访客在卡上做过的事（取消了那场会 / 发了确认信）没有别的地方能让模型知道 —— 不折回来，
// 刷新之后 agent 又会当那场会还在（F-B-9）。
//
// 按时间归并，不是把事件甩到末尾：模型读到的顺序就是发生的顺序。
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

// revalidateSession —— 一轮 chat 出错后回头确认会话是否还活着(失效 → 收口),
// 不重建 transcript(当前对话还在内存,别动)。
export async function revalidateSession(conversationID: string, token: string): Promise<void> {
  const res = await fetchConversation(conversationID, token);
  if (res.status === 'invalid') {
    recoverFromDeadSession();
    return;
  }
  if (res.status === 'ok') reconcileView(res.view);
}

// revalidateStored —— 同上,但 conv id + token 从 stored session 取(catch 分支
// 拿不到 sess 时用)。无凭据 → 跳过。
export async function revalidateStored(): Promise<void> {
  const stored = loadStoredSession();
  const token = stored?.session_token ?? '';
  const conv = stored?.conversation_id ?? '';
  if (token !== '' && conv !== '') await revalidateSession(conv, token);
}

function applyView(v: VisitorView, setDialogs: DialogSetter): void {
  reconcileView(v);
  // transcript 只在当前为空时重建 —— 别盖掉 fetch 期间用户刚问的那轮。
  if (v.dialogs.length > 0) setDialogs((prev) => (prev.length === 0 ? toDialogs(v) : prev));
}

// reconcileView —— 用后端权威值覆盖本地展示缓存(身份 + code 配额 + member 级
// used)。used 取后端 **member 级** 合计(多对话下不能从单 surface 本地 dialogs
// 数);只在 load / 失败收口时跑,不跟成功 turn 的乐观 +1 抢。byoai(无 code,
// 无限额)不碰。名字后端给空就保留本地(匿名兜底)。
function reconcileView(v: VisitorView): void {
  const cur = useVisitorSessionStore.getState().session;
  if (cur === null || cur.byoai) return;
  useVisitorSessionStore.getState().setSession(mergeView(cur, v));
}

function mergeView(cur: VisitorSession, v: VisitorView): VisitorSession {
  return {
    ...cur,
    max: v.maxTurns,
    // used 以后端 **member 级** 合计为准(多对话下不能从单 surface 本地 dialogs
    // 数,会少算)。reconcile 只在 load / 失败收口时跑,不跟成功 turn 的乐观 +1
    // 抢,所以这里直接采纳后端值不会盖掉刚发那轮。
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

// toCitations —— 聚合里的引用(genre/path/title)重建成前端 Citation。id/body
// restore 时拿不到也不需要(CitationRow 只用 genre/path 算链接、title 显示)。
//
// slug 恒空,而这里**不是**在偷懒:存下来的那份 `DialogCitationSchema` 的 genre 枚举只有
// `wiki | output` —— writings 压根不在持久化的逐字稿里,所以这条路到不了需要 slug 的那一格。
// （顺带说明了 href 那个缺陷为什么只在实时那一轮暴露：刷新之后 writing 的引用整条就没了。
//   那是同一族的另一个缺口，单独记着，不在这一趟里扩。）
function toCitations(cites: readonly DialogCitation[] | undefined): Citation[] {
  return (cites ?? []).map((c): Citation => ({
    genre: c.genre, id: '', path: c.path, slug: '', title: c.title, body: '',
  }));
}
