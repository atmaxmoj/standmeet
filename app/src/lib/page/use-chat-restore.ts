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

import { fetchConversation, type VisitorView, type DialogCitation } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';
import type { Citation, Dialog } from '@/lib/page/use-chat';
import { recoverFromDeadSession } from '@/lib/visitor/session-recovery';
import { useVisitorSessionStore, type VisitorSession } from '@/lib/visitor/session-store';

type DialogSetter = Dispatch<SetStateAction<Dialog[]>>;

// splitParas —— body → 段落(连续空行分段;空 body → 空数组)。
export function splitParas(body: string): string[] {
  const trimmed = body.trim();
  return trimmed === ''
    ? []
    : trimmed.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
}

// restoreSession —— 载入时拉会话:活着 → reconcile + 重建 transcript;失效 →
// 清身份回入口;抖动(error)→ 保持现状不崩。
export async function restoreSession(
  conversationID: string, token: string, setDialogs: DialogSetter,
): Promise<void> {
  const res = await fetchConversation(conversationID, token);
  if (res.status === 'invalid') {
    recoverFromDeadSession();
    return;
  }
  if (res.status !== 'ok') return;
  applyView(res.view, setDialogs);
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
  // transcript 只在当前为空时重建 —— 别盖掉 fetch 期间用户刚问的那轮。重建后
  // useChat 的 mirror effect 会从 dialogs 数出 used,无需在这碰 used。
  if (v.dialogs.length > 0) setDialogs((prev) => (prev.length === 0 ? toDialogs(v) : prev));
}

// reconcileView —— 用后端权威值覆盖本地展示缓存(身份 + code 配额)。used 不在
// 这碰 —— 它派生自 dialogs(useChat mirror)。byoai(无 code,无限额)不碰。名字
// 后端给空就保留本地(匿名兜底)。
function reconcileView(v: VisitorView): void {
  const cur = useVisitorSessionStore.getState().session;
  if (cur === null || cur.byoai) return;
  useVisitorSessionStore.getState().setSession(mergeView(cur, v));
}

function mergeView(cur: VisitorSession, v: VisitorView): VisitorSession {
  return {
    ...cur,
    max: v.maxTurns,
    maxMembers: v.maxMembers,
    memberCount: v.memberCount,
    visitor: v.visitorName !== '' ? v.visitorName : cur.visitor,
  };
}

function toDialogs(v: VisitorView): Dialog[] {
  return v.dialogs.map((d, i): Dialog => ({
    id: `h${i}`, q: d.question, time: '', pending: false,
    currentTool: null, toolCalls: [...d.tool_calls], retrying: false, failed: false,
    answer: {
      paras: splitParas(d.answer), citations: toCitations(d.citations),
      private: false, byoaiBlocked: false,
    },
  }));
}

// toCitations —— 聚合里的引用(genre/path/title)重建成前端 Citation。id/body
// restore 时拿不到也不需要(CitationRow 只用 genre/path/title 渲链接)。
function toCitations(cites: readonly DialogCitation[] | undefined): Citation[] {
  return (cites ?? []).map((c): Citation => ({
    genre: c.genre, id: '', path: c.path, title: c.title, body: '',
  }));
}
