// use-account —— owner 自助管理账号字段。三个 PATCH endpoint：
//   PATCH /api/admin/account/full-name    { full_name }
//   PATCH /api/admin/account/email        { current_password, new_email }
//   PATCH /api/admin/account/password     { current_password, new_password }
//
// 写完后让 sessionStore.refresh() 把 /me 拉回来；admin sidebar / public URL
// 等读 session 的地方下次访问自动是新值。

import { useCallback, useState } from 'react';

import { z } from 'zod';

import { sessionStore } from '@/lib/admin/use-admin-session';
import { adminAPI } from '@/lib/api/admin';

const FullNameRespSchema = z.object({ full_name: z.string() });
const EmailRespSchema = z.object({ email: z.string() });

export interface AccountHook {
  pending: boolean;
  error: string | null;
  updateFullName: (raw: string) => Promise<string | null>;
  updateEmail: (currentPassword: string, newEmail: string) => Promise<string | null>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  clearError: () => void;
}

export function useAccount(): AccountHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFullName = useCallback(async (raw: string): Promise<string | null> => {
    return runUpdate(setPending, setError, async () => {
      const res = await adminAPI.patch('/account/full-name', { full_name: raw }, FullNameRespSchema);
      sessionStore.getState().reset();
      return res.full_name;
    });
  }, []);

  const updateEmail = useCallback(
    async (currentPassword: string, newEmail: string): Promise<string | null> => {
      return runUpdate(setPending, setError, async () => {
        const res = await adminAPI.patch('/account/email', {
          current_password: currentPassword, new_email: newEmail,
        }, EmailRespSchema);
        sessionStore.getState().reset();
        return res.email;
      });
    }, [],
  );

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
  return { pending, error, updateFullName, updateEmail, updatePassword, clearError };
}

// runUpdate —— 三个 PATCH 共享的 try/catch/状态机模板。
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
