// session-gone —— what happens when a turn is refused because its session no longer exists.
//
// A code's sessions are purged when the owner revokes it, and a session lapses after an idle hour.
// Two different visitors stand behind that one 401:
//   - their code still opens (the session merely lapsed): the existing re-entry flow takes over —
//     the code goes back to pending and the name picker asks who they are (session-recovery.ts);
//   - their code no longer opens (revoked, expired) or they never had one: they are a public
//     visitor now. Where the page answers the public, their question is asked again on a fresh
//     public session, so they get an answer instead of a dead box (the owner's home page,
//     2026-10-04: a revoked code's visitor saw "error: issue session: 400", then nothing). Where
//     it does not, they go to the gate, as before.

'use client';

import { publicChatEnabled } from '@standmeet/sdk-core';

import { codeStillOpens } from './api.js';
import { clearVisitorSession, recoverFromDeadSession } from './session-recovery.js';
import { peekStoredSession } from './session-store.js';
import { usePendingCodeStore } from './use-pending-code-store.js';

/** Settles the dead session. True = ask the question again (on a fresh public session). */
export async function settleGoneSession(): Promise<boolean> {
  const code = peekStoredSession()?.code ?? usePendingCodeStore.getState().code ?? '';
  if (code !== '' && await codeStillOpens(code)) {
    recoverFromDeadSession();
    return false;
  }
  clearVisitorSession();
  usePendingCodeStore.getState().consume();
  if (publicChatEnabled()) return true;
  recoverFromDeadSession(); // no code left → the gate
  return false;
}
