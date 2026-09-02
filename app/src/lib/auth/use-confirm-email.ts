// use-confirm-email —— the moment right after the confirm link is opened.
// Business decisions live here; the presentation layer only renders.
//
// The three outcomes are kept deliberately separate, because what the owner
// should do next is completely different for each:
//   confirmed —— email changed, go sign in
//   expired   —— link expired, go back to the panel and save again (**this path still exists**)
//   invalid   —— this email isn't for you / already used
//
// Collapsing this into a single boolean would merge "expired" and "invalid"
// into one message, which is exactly
// [[collapsed-error-class-kills-its-own-branch]]: the guidance written for
// one of those cases would never surface.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { confirmEmail } from '@/lib/api/auth';

export type ConfirmEmailState =
  | { kind: 'working' }
  | { kind: 'confirmed'; email: string }
  | { kind: 'expired' }
  | { kind: 'invalid' };

// classifyConfirmError —— the backend's error code decides which message to
// show. An unrecognized code is always treated as invalid: an unexpected
// failure should never render as "success".
function classifyConfirmError(code: string): ConfirmEmailState {
  return code === 'email_confirm_expired' ? { kind: 'expired' } : { kind: 'invalid' };
}

export function useConfirmEmail(token: string): ConfirmEmailState {
  const [state, setState] = useState<ConfirmEmailState>({ kind: 'working' });

  const run = useCallback(async (): Promise<void> => {
    // Skip asking the backend when there's no token — an empty token would
    // come back with the same error as "this email was made up", but we
    // already know the answer here.
    if (token === '') {
      setState({ kind: 'invalid' });
      return;
    }
    const res = await confirmEmail(token);
    setState(res.ok ? { kind: 'confirmed', email: res.email } : classifyConfirmError(res.code));
  }, [token]);

  useEffect(() => { void run(); }, [run]);
  return state;
}
