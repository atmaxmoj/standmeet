// use-recover-form —— #100 account recovery 状态机（镜像 use-login-form）。
//
// 业务规则:
//   - email + recovery phrase 非空
//   - submit 调 /api/admin/recover，成功后 backend 写 session cookie（跟 login 同）
//   - error 走单 string field（401 = "email or recovery phrase incorrect"）
// busy 锁防重发。

import { useCallback, useState } from 'react';

import { recover } from '@/lib/api/auth';

export interface RecoverFormHook {
  email: string;
  phrase: string;
  error: string | null;
  busy: boolean;
  setEmail: (v: string) => void;
  setPhrase: (v: string) => void;
  submit: () => Promise<boolean>;
}

export function useRecoverForm(): RecoverFormHook {
  const [email, setEmail] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<boolean> => {
    const blank = email.trim() === '' || phrase.trim() === '';
    if (blank) { setError('email + recovery phrase required'); return false; }
    setError(null);
    setBusy(true);
    try {
      await recover({ email: email.trim(), recovery_phrase: phrase.trim() });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'recovery failed');
      return false;
    } finally {
      setBusy(false);
    }
  }, [email, phrase]);

  return { email, phrase, error, busy, setEmail, setPhrase, submit };
}
