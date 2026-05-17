// use-setup-form —— first-run setup wizard 状态机。
//
// 业务规则:
//   - step 1：name + handle，必填，handle 只允许 [a-z0-9-]
//   - step 2：email + password + confirm，password ≥ 8，两次输入一致
//   - submit：调 /api/admin/claim，成功后回调 onClaimed(handle)
// busy 锁防重发；error 走单 string field（清晰够用）。
//
// 摆 lib/ 是因为 components/ + app/**/*.tsx 禁 `if`，wizard 的分支
// 控制走 hook 干净。

import { useCallback, useState } from 'react';

import { claim, type ClaimResult } from '@/lib/api/auth';

export type SetupStep = 1 | 2;

export interface SetupFormState {
  full: string;
  handle: string;
  email: string;
  password: string;
  passwordConfirm: string;
}

export interface SetupFormHook {
  step: SetupStep;
  form: SetupFormState;
  error: string | null;
  busy: boolean;
  setField: (key: keyof SetupFormState, value: string) => void;
  next: () => void;
  back: () => void;
  submit: () => Promise<ClaimResult | null>;
}

const HANDLE_PATTERN = /[^a-z0-9-]/g;
const MIN_PASSWORD = 8;

export function useSetupForm(setupToken: string): SetupFormHook {
  const [step, setStep] = useState<SetupStep>(1);
  const [form, setForm] = useState<SetupFormState>({
    full: '', handle: '', email: '', password: '', passwordConfirm: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setField = useCallback((key: keyof SetupFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: normalizeField(key, value) }));
  }, []);

  const next = useCallback(() => setStep(2), []);
  const back = useCallback(() => setStep(1), []);

  const submit = useCallback(async (): Promise<ClaimResult | null> => {
    const validation = validateForm(form);
    setError(validation);
    if (validation) return null;
    setBusy(true);
    try {
      return await claim({
        token: setupToken,
        email: form.email.trim(),
        password: form.password,
        handle: form.handle,
        full_name: form.full,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'claim failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [form, setupToken]);

  return { step, form, error, busy, setField, next, back, submit };
}

function normalizeField(key: keyof SetupFormState, value: string): string {
  return key === 'handle' ? value.toLowerCase().replace(HANDLE_PATTERN, '') : value;
}

function validateForm(f: SetupFormState): string | null {
  const trimmedEmail = f.email.trim();
  const blank = !trimmedEmail || f.password === '';
  if (blank) return 'email + password required';
  if (f.password.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  if (f.password !== f.passwordConfirm) return 'passwords don’t match';
  return null;
}
