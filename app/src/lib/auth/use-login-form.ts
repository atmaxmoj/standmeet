// use-login-form —— owner sign-in state machine.
//
// Business rules:
//   - email + password must be non-empty
//   - submit calls /api/admin/login; on success the backend writes a session cookie
//   - error goes through a single string field (401 = "wrong email or password")
// The busy lock prevents double submission.

import { useCallback, useState } from 'react';

import { login, type LoginResult } from '@/lib/api/auth';

export interface LoginFormHook {
  email: string;
  password: string;
  captchaToken: string;
  error: string | null;
  busy: boolean;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  setCaptchaToken: (v: string) => void;
  submit: () => Promise<LoginResult | null>;
}

export function useLoginForm(): LoginFormHook {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<LoginResult | null> => {
    const blank = email.trim() === '' || password === '';
    if (blank) { setError('email + password required'); return null; }
    setError(null);
    setBusy(true);
    try {
      return await login({ email: email.trim(), password, captcha_token: captchaToken });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [email, password, captchaToken]);

  return {
    email, password, captchaToken, error, busy,
    setEmail, setPassword, setCaptchaToken, submit,
  };
}
