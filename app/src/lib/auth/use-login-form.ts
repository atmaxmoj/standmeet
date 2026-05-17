// use-login-form —— owner sign-in 状态机。
//
// 业务规则:
//   - email + password 非空
//   - submit 调 /api/admin/login，成功后 backend 写 session cookie
//   - error 走单 string field（401 = "wrong email or password"）
// busy 锁防重发。

import { useCallback, useState } from 'react';

import { login, type LoginResult } from '@/lib/api/auth';

export interface LoginFormHook {
  email: string;
  password: string;
  error: string | null;
  busy: boolean;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  submit: () => Promise<LoginResult | null>;
}

export function useLoginForm(): LoginFormHook {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<LoginResult | null> => {
    const blank = email.trim() === '' || password === '';
    if (blank) { setError('email + password required'); return null; }
    setError(null);
    setBusy(true);
    try {
      return await login({ email: email.trim(), password });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  return { email, password, error, busy, setEmail, setPassword, submit };
}
