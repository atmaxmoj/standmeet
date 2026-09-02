// session-recovery —— the single convergence point for a dead backend
// session (401).
//
// Principle: the backend session is the only source of truth. Once a token
// is rejected by the backend (expired / instance reset / revoked), the
// client can no longer blithely keep pretending it's still signed in using
// the old identity (name / quota) in localStorage — it must be cleared,
// and control returns to the entry flow.
//
// Where to go back to: whether an access code is still on hand (an access
// code is the credential for entering chat).
//   - Has a code → re-enter the "has a code" flow: put the code back into
//     pending, pop the name picker, ask for a name like a first-time
//     entry and issue a brand-new session (which also re-validates the
//     code is still good).
//   - No code → fall back to /gate.

'use client';

import { clearStoredSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { peekStoredSession, useVisitorSessionStore } from '@/lib/visitor/session-store';

// clearVisitorSession —— clears both localStorage entries together: the
// display identity (standmeet-session) + the chat auth credential
// (standmeet:visitor-session). Avoids holding onto a dead token / stale
// name.
export function clearVisitorSession(): void {
  useVisitorSessionStore.getState().clear();
  clearStoredSession();
}

// clearAndPreserveCode —— clears the dead session, but first rescues the
// access code into pending (if there is one), and returns whether a code
// was rescued. Both entry points into dead-session handling must go
// through this:
//   1. the mount probe validate-session (401 → clear)
//   2. chat restore's recoverFromDeadSession
// Otherwise there's a race: if the probe's "bare clear" (not re-seeding the
// code) wins the race, the code is lost — the later restore can't find it
// in localStorage or pending, wrongly concludes "no code" and jumps to
// /gate instead of re-popping the name picker. The code is read from
// localStorage first, falling back to pending (when both instances on the
// same page run cleanup, the first one has already stuffed the code into
// pending).
export function clearAndPreserveCode(): boolean {
  const code = peekStoredSession()?.code ?? usePendingCodeStore.getState().code ?? '';
  clearVisitorSession();
  if (code !== '') {
    usePendingCodeStore.getState().setCode(code);
    return true;
  }
  return false;
}

// recoverFromDeadSession —— clears the dead session and returns to the
// entry flow depending on whether there's a code: has a code → re-seed
// pending (name picker pops again); no code → fall back to /gate.
export function recoverFromDeadSession(): void {
  if (clearAndPreserveCode()) return;
  if (typeof window !== 'undefined') {
    window.location.href = '/gate';
  }
}
