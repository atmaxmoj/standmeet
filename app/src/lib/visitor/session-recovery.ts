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

// clearAndPreserveCode —— 清掉失效会话,但清之前先把 access code 抢救进 pending
// (有的话),返回是否救回了 code。dead-session 的两个入口都必须走这个:
//   1. mount 探针 validate-session(401 → 清)
//   2. chat restore recoverFromDeadSession
// 否则会竞态:探针「裸清」(不重塞 code)若先跑赢,code 就丢了 → 后跑的 restore
// 从 localStorage / pending 都读不到 → 误判「没 code」错跳 /gate,而不是重弹名字
// 选择器。code 优先从 localStorage 读,读不到退到 pending(同页两个实例都跑清理时,
// 第一个已把 code 塞进 pending)。
export function clearAndPreserveCode(): boolean {
  const code = peekStoredSession()?.code ?? usePendingCodeStore.getState().code ?? '';
  clearVisitorSession();
  if (code !== '') {
    usePendingCodeStore.getState().setCode(code);
    return true;
  }
  return false;
}

// recoverFromDeadSession —— 清掉失效会话,按有没有 code 回到入口流程:有 code →
// 重塞 pending(名字选择器重弹);没 code → 退回 /gate。
export function recoverFromDeadSession(): void {
  if (clearAndPreserveCode()) return;
  if (typeof window !== 'undefined') {
    window.location.href = '/gate';
  }
}
