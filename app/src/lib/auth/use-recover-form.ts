// use-recover-form —— #100 account recovery state machine (mirrors use-login-form).
//
// Business rules:
//   - email + recovery phrase must be non-empty
//   - submit calls /api/admin/recover; on success the backend writes a session cookie (same as login)
//   - error goes through a single string field (401 = "email or recovery phrase incorrect")
// The busy lock prevents double submission.

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
