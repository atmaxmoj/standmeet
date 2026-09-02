// use-account —— owner self-service management of account fields. Three PATCH endpoints:
//   PATCH /api/admin/account/full-name    { full_name }
//   PATCH /api/admin/account/email        { current_password, new_email }
//   PATCH /api/admin/account/password     { current_password, new_password }
//
// After a write, sessionStore.refresh() pulls /me back; the admin sidebar /
// public URL and other places that read the session pick up the new value automatically on their next access.

import { useCallback, useState } from 'react';

import { z } from 'zod';

import { sessionStore } from '@/lib/admin/use-admin-session';
import { adminAPI } from '@/lib/api/admin';

const FullNameRespSchema = z.object({ full_name: z.string() });
// EmailRespSchema —— the receipt must say clearly **what happened**:
// pending_email non-empty = a confirmation email was sent, identity hasn't
// moved; empty = changed on the spot. The two copy strings on the UI differ,
// and a receipt that can't tell them apart would leave the owner thinking
// the change had already gone through (non-unique signal).
// pending_email is optional: the backend has omitempty, so this field simply
// doesn't appear when there's nothing pending — `.optional()` rather than
// `.default('')`, because "absent" and "empty string" mean the same thing
// here, but the schema has to tolerate the field being absent ([[zod-unknown-is-not-optional]]).
const EmailRespSchema = z.object({
  email: z.string(),
  pending_email: z.string().optional(),
});

// EmailChangeResult —— the outcome of one email change. pending non-empty = still waiting on confirmation of the new address.
export interface EmailChangeResult {
  email: string;
  pending: string;
}

export interface AccountHook {
  pending: boolean;
  error: string | null;
  updateFullName: (raw: string) => Promise<string | null>;
  updateEmail: (currentPassword: string, newEmail: string) => Promise<EmailChangeResult | null>;
  cancelEmailChange: () => Promise<string | null>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  clearError: () => void;
}

export function useAccount(): AccountHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFullName = useCallback(async (raw: string): Promise<string | null> => {
    return runUpdate(setPending, setError, async () => {
      const res = await adminAPI.patch('/account/full-name', { full_name: raw }, FullNameRespSchema);
      await sessionStore.getState().refresh();
      return res.full_name;
    });
  }, []);

  const updateEmail = useCallback(
    async (currentPassword: string, newEmail: string): Promise<EmailChangeResult | null> => {
      return runUpdate(setPending, setError, async () => {
        const res = await adminAPI.patch('/account/email', {
          current_password: currentPassword, new_email: newEmail,
        }, EmailRespSchema);
        await sessionStore.getState().refresh();
        return { email: res.email, pending: res.pending_email ?? '' };
      });
    }, [],
  );

  const cancelEmailChange = useCallback(async (): Promise<string | null> => {
    return runUpdate(setPending, setError, async () => {
      const res = await adminAPI.post('/account/email/cancel', {}, EmailRespSchema);
      await sessionStore.getState().refresh();
      return res.email;
    });
  }, []);

  const updatePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<boolean> => {
      const result = await runUpdate(setPending, setError, async () => {
        await adminAPI.patchVoid('/account/password', {
          current_password: currentPassword, new_password: newPassword,
        });
        return true;
      });
      return result === true;
    }, [],
  );

  const clearError = useCallback(() => setError(null), []);
  return {
    pending, error, updateFullName, updateEmail, cancelEmailChange,
    updatePassword, clearError,
  };
}

// runUpdate —— the shared try/catch/state-machine template for the three PATCH calls.
async function runUpdate<T>(
  setPending: (b: boolean) => void,
  setError: (m: string | null) => void,
  fn: () => Promise<T>,
): Promise<T | null> {
  setPending(true);
  setError(null);
  try {
    return await fn();
  } catch (e) {
    setError(e instanceof Error ? e.message : 'update failed');
    return null;
  } finally {
    setPending(false);
  }
}
