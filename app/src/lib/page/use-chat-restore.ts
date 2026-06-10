// use-chat-restore —— 载入恢复 + reconcile。凭 session token 拉后端权威快照:
//   - 重建 transcript(历史 Q&A)
//   - 把 strip 的 used / max / 名额 / 名字 全部按后端数出来的纠回本地缓存
//     (后端 conversation + code 是唯一 source of truth)
//   - token 已失效(401)→ 清掉旧身份,按有没有 code 回入口流程
//
// splitParas 也搬这儿(use-chat 的 withAnswer 也用,反过来 import)。

'use client';

import { fetchSessionSnapshot, type SessionSnapshot } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';
import type { Dialog } from '@/lib/page/use-chat';
import { recoverFromDeadSession } from '@/lib/visitor/session-recovery';
import { useVisitorSessionStore, type VisitorSession } from '@/lib/visitor/session-store';

// splitParas —— body → 段落(连续空行分段;空 body → 空数组)。
export function splitParas(body: string): string[] {
  const trimmed = body.trim();
  return trimmed === ''
    ? []
    : trimmed.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
}

// restoreSession —— 载入时拉快照:活着 → reconcile + 重建 transcript;失效 →
// 清身份回入口;抖动(error)→ 保持现状不崩。
export async function restoreSession(
  token: string, setDialogs: (ds: Dialog[]) => void,
): Promise<void> {
  const res = await fetchSessionSnapshot(token);
  if (res.status === 'invalid') {
    recoverFromDeadSession();
    return;
  }
  if (res.status !== 'ok') return;
  applySnapshot(res.snapshot, setDialogs);
}

// revalidateSession —— 一轮 chat 出错后回头确认会话是否还活着(失效 → 收口),
// 不重建 transcript(当前对话还在内存,别动)。
export async function revalidateSession(token: string): Promise<void> {
  const res = await fetchSessionSnapshot(token);
  if (res.status === 'invalid') {
    recoverFromDeadSession();
    return;
  }
  if (res.status === 'ok') reconcileSnapshot(res.snapshot);
}

// revalidateStored —— 同上,但 token 从 stored session 取(catch 分支拿不到
// sess 时用)。无 token → 跳过。
export async function revalidateStored(): Promise<void> {
  const token = loadStoredSession()?.session_token ?? '';
  if (token !== '') await revalidateSession(token);
}

function applySnapshot(s: SessionSnapshot, setDialogs: (ds: Dialog[]) => void): void {
  reconcileSnapshot(s);
  if (s.dialogs.length > 0) setDialogs(toDialogs(s));
}

// reconcileSnapshot —— 用后端权威值覆盖本地展示缓存。byoai(无 code,无限额)
// 不碰。名字后端给空就保留本地(byoai / 匿名兜底)。
function reconcileSnapshot(s: SessionSnapshot): void {
  const store = useVisitorSessionStore.getState();
  const cur = store.session;
  if (cur === null || cur.byoai) return;
  store.setSession(mergeSnapshot(cur, s));
}

function mergeSnapshot(cur: VisitorSession, s: SessionSnapshot): VisitorSession {
  return {
    ...cur,
    used: s.usedTurns,
    max: s.maxTurns,
    maxMembers: s.maxMembers,
    memberCount: s.memberCount,
    visitor: s.visitorName !== '' ? s.visitorName : cur.visitor,
  };
}

function toDialogs(s: SessionSnapshot): Dialog[] {
  return s.dialogs.map((d, i): Dialog => ({
    id: `h${i}`, q: d.question, time: '', pending: false,
    currentTool: null, toolCalls: [], retrying: false,
    answer: { paras: splitParas(d.answer), citations: [], private: false, byoaiBlocked: false },
  }));
}
