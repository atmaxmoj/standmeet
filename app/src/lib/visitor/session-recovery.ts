// session-recovery —— 后端 session 失效(401)时的统一收口。
//
// 原则:后端 session 是唯一 source of truth。token 一旦被后端拒(过期 / 实例
// 重置 / 撤销),客户端就不能再 blithe 地拿着 localStorage 里的旧身份(名字 /
// 配额)装作还登录着 —— 必须清掉,回到入口流程。
//
// 回哪:看手里还有没有 access code(access code 是进 chat 的凭据)。
//   - 有 code → 重新走「有 code」入口:把 code 塞回 pending,弹名字选择器,
//     像第一次进来那样问名字、issue 一段全新的会(顺便重新校验 code 还有效)。
//   - 没 code → 退回 /gate。

'use client';

import { clearStoredSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { peekStoredSession, useVisitorSessionStore } from '@/lib/visitor/session-store';

// clearVisitorSession —— 两份 localStorage 一起清:展示身份(standmeet-session)
// + chat 鉴权凭据(standmeet:visitor-session)。免得拿着死 token / 旧名字。
export function clearVisitorSession(): void {
  useVisitorSessionStore.getState().clear();
  clearStoredSession();
}

// recoverFromDeadSession —— 清掉失效会话,按有没有 code 回到入口流程。code 从
// localStorage 直接读(不信 in-memory store —— hydrate 时序有竞态,清掉后再读
// 会误判成「没 code」而错跳 /gate)。
export function recoverFromDeadSession(): void {
  const code = peekStoredSession()?.code ?? '';
  clearVisitorSession();
  if (code !== '') {
    usePendingCodeStore.getState().setCode(code);
    return;
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/gate';
  }
}
