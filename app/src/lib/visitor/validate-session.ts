// validate-session —— F-L-11: probe the stored visitor bearer against GET /api/v1/session on mount.
//
// Visitor sessions expire in Redis (sliding TTL) while the browser keeps the token in localStorage
// indefinitely. After the TTL lapses the reader still rendered full "unlocked" chrome from
// localStorage and fetched scoped data anonymously (→ empty body under a header boasting a corpus the
// viewer can't see — owner-flagged "这个可不行"). A 401 from the probe means the token is dead → clear
// BOTH the credential store (session_token) and the display store (the chrome) so the strip drops to
// the honest anonymous state. A network blip is NOT treated as dead — don't nuke a good session on a
// transient failure (fail-open: an over-eager clear would log a live visitor out on one flaky GET).

import { loadStoredSession } from '@/lib/gate/use-gate';
import { clearAndPreserveCode } from '@/lib/visitor/session-recovery';

export async function validateVisitorSession(): Promise<void> {
  const sess = loadStoredSession();
  if (sess === null) return;
  let res: Response;
  try {
    res = await fetch('/api/v1/session', {
      headers: { Authorization: `Bearer ${sess.session_token}` },
    });
  } catch {
    return; // transient network failure — keep the session (fail-open)
  }
  if (res.status === 401) {
    // 死 token → 清身份(展示 + 凭据),但把 code 抢救进 pending:有 code 的访客
    // 会话过期后该重弹名字选择器重新入会(跟 chat restore 同一收口,避免"裸清 vs
    // 重塞 code"竞态丢 code 错跳 /gate)。没 code(匿名过期)→ 就地掉回匿名(F-L-11)。
    clearAndPreserveCode();
  }
}
