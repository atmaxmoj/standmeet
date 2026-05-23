// use-password-reset-form —— /account/reset?t=... 表单状态机。
//
// 前端校验：new ≥ 12 chars + new == confirm。提交 POST
// /api/v1/account/reset-password { token, new_password }。
// 成功返 true（caller router.push('/login')），失败 setError。

'use client';

import { useCallback, useState } from 'react';

import { resetPassword } from '@/lib/api/auth';

export interface PasswordResetFormHook {
  next: string;
  confirm: string;
  busy: boolean;
  error: string | null;
  setNext: (v: string) => void;
  setConfirm: (v: string) => void;
  submit: (token: string) => Promise<boolean>;
}

const minPasswordLen = 12;

export function usePasswordResetForm(): PasswordResetFormHook {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (token: string): Promise<boolean> => {
    const valid = validate(next, confirm);
    if (valid !== null) { setError(valid); return false; }
    setError(null);
    setBusy(true);
    const ok = await callReset(token, next, setError);
    setBusy(false);
    return ok;
  }, [next, confirm]);

  return { next, confirm, busy, error, setNext, setConfirm, submit };
}

function validate(next: string, confirm: string): string | null {
  if (next.length < minPasswordLen) return 'new password must be at least 12 characters';
  if (next !== confirm) return 'new password and confirm do not match';
  return null;
}

async function callReset(
  token: string, newPassword: string, setError: (m: string | null) => void,
): Promise<boolean> {
  try {
    await resetPassword({ token, new_password: newPassword });
    return true;
  } catch (e) {
    setError(e instanceof Error ? e.message : 'reset failed');
    return false;
  }
}
