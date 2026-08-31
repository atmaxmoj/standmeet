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
// EmailRespSchema —— 回执要说清**发生了什么**：pending_email 非空 = 寄了一封确认信、
// 身份没动；空 = 当场换好了。界面上那两句话不一样，而一个说不出区别的回执会让 owner
// 以为已经改完了（non-unique signal）。
// pending_email 是 optional：后端 omitempty，没有待确认时这个字段根本不出现 ——
// 用 `.optional()` 而不是 `.default('')`，因为"缺席"和"空串"在这里是同一个意思，
// 但 schema 得受得住缺席（[[zod-unknown-is-not-optional]]）。
const EmailRespSchema = z.object({
  email: z.string(),
  pending_email: z.string().optional(),
});

// EmailChangeResult —— 改邮箱这一下的产物。pending 非空 = 还在等新地址确认。
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
