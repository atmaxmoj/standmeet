// validate-session —— F-L-11: probe the stored visitor bearer against GET /api/v1/session on mount.
//
// Visitor sessions expire in Redis (sliding TTL) while the browser keeps the token in localStorage
// indefinitely. After the TTL lapses the reader still rendered full "unlocked" chrome from
// localStorage and fetched scoped data anonymously (→ empty body under a header boasting a corpus the
// viewer can't see — owner-flagged "this one's not okay"). A 401 from the probe means the token is dead → clear
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
    // Dead token → clear the identity (display + credential), but rescue
    // the code into pending first: a visitor who had a code should get the
    // name picker again once their session expires, re-entering (the same
    // convergence point as chat restore, avoiding a "bare clear vs.
    // re-seed code" race that loses the code and wrongly jumps to /gate).
    // No code (anonymous expiry) → falls straight back to anonymous (F-L-11).
    clearAndPreserveCode();
  }
}
