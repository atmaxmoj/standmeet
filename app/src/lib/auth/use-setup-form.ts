// use-setup-form —— first-run setup wizard state machine.
//
// Design source: docs/design/project/auth.js Setup. 4 steps:
//   1. identity      —— name + handle + publicUrl
//   2. credentials   —— email + password + confirm
//   3. ai provider   —— provider chip + key + model (skippable, can be filled in later from the admin panel)
//   4. review        —— summary card → claim
//
// Step 3's provider/model/key ship in the same request as claim; the server
// persists it immediately after claim succeeds (`setupAIProvider` in
// `routes/admin/claim.go`).
// **This used to say "a follow-up PATCH after claim" — that "follow-up" never
// actually happened** (F-H-2): the comment described a behavior that didn't
// exist, and nothing in the UI contradicted it.
//
// **Step 4 used to have an arithmetic captcha too; it's been removed
// (F-H-1).**
// It was client-only: `claimRequest` in `routes/admin/claim.go` only has
// token/email/password/handle/full_name/public_url —— **the backend never
// saw that answer at all**. The real authorization is the **one-time setup
// token** (printed in the backend log, reachable only by someone who can
// read the server), so claim doesn't even go through loginGuard.
//
// So that arithmetic captcha had negative value: automation that can read
// the token can obviously do addition too, so it stops zero bots; the only
// thing it blocked was **a legitimate agent the owner themselves hooked
// up** — and being driven purely automatically by the owner's AI client is
// the product's stated goal (the whole job-loop chain has exactly one path,
// through MCP, by design).
//
// **Only this one decorative piece was removed.** Nothing on the outward
// defenses changed: gate/login's per-IP lockout, and the backend turnstile
// (when enabled), are both still there — those are checks the server
// actually enforces.
//
// Business rules:
//   - step 1: name + handle + publicUrl required, handle allows only [a-z0-9-]
//   - step 2: email + password + confirm, password >= 8, both entries must match
//   - step 3: a chosen provider must have a key (ollama is the exception, no key needed locally); the whole step can be skipped
//   - step 4: just a review of the summary card, submittable at any time
//
// Placed in lib/ because components/ + app/**/*.tsx forbid `if`, so the
// wizard's branch logic lives cleanly in a hook instead.

import { useCallback, useState } from 'react';

import { claim, type ClaimResult } from '@/lib/api/auth';

export type SetupStep = 1 | 2 | 3 | 4;

export interface AIProviderEntry {
  id: string;
  label: string;
  defaultModel: string;
  prefix: string;
  issuer: string;
  needsKey: boolean;
}

export const SETUP_PROVIDERS: readonly AIProviderEntry[] = [
  {
    id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-sonnet-4',
    prefix: 'sk-ant-…', issuer: 'console.anthropic.com', needsKey: true,
  },
  {
    id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5',
    prefix: 'sk-…', issuer: 'platform.openai.com', needsKey: true,
  },
  {
    id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat',
    prefix: 'sk-…', issuer: 'platform.deepseek.com', needsKey: true,
  },
  {
    id: 'kimi', label: 'Kimi · Moonshot', defaultModel: 'moonshot-v1-8k',
    prefix: 'sk-…', issuer: 'platform.moonshot.cn', needsKey: true,
  },
  {
    id: 'groq', label: 'Groq', defaultModel: 'llama-3.3-70b-versatile',
    prefix: 'gsk_…', issuer: 'console.groq.com', needsKey: true,
  },
  {
    id: 'siliconflow', label: 'SiliconFlow', defaultModel: 'deepseek-ai/DeepSeek-V3',
    prefix: 'sk-…', issuer: 'siliconflow.cn', needsKey: true,
  },
  {
    id: 'openrouter', label: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-4',
    prefix: 'sk-or-…', issuer: 'openrouter.ai', needsKey: true,
  },
  {
    id: 'together', label: 'Together AI', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    prefix: 'API key', issuer: 'together.ai', needsKey: true,
  },
  {
    id: 'custom', label: 'Custom · self-hosted (ollama / vllm / lm-studio)', defaultModel: 'llama3.3',
    prefix: 'no key — runs locally', issuer: 'your endpoint', needsKey: false,
  },
];

export interface SetupFormState {
  full: string;
  handle: string;
  publicUrl: string;
  email: string;
  password: string;
  passwordConfirm: string;
  aiProvider: string;
  aiKey: string;
  aiModel: string;
}

export interface SetupFormHook {
  step: SetupStep;
  form: SetupFormState;
  error: string | null;
  busy: boolean;
  canAdvance: boolean;
  provider: AIProviderEntry;
  setField: (key: keyof SetupFormState, value: string) => void;
  pickProvider: (id: string) => void;
  next: () => void;
  back: () => void;
  submit: () => Promise<ClaimResult | null>;
}

const HANDLE_PATTERN = /[^a-z0-9-]/g;
const MIN_PASSWORD = 8;

export function useSetupForm(setupToken: string): SetupFormHook {
  const [step, setStep] = useState<SetupStep>(1);
  const [form, setForm] = useState<SetupFormState>(initialState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const provider = SETUP_PROVIDERS.find((p) => p.id === form.aiProvider) ?? SETUP_PROVIDERS[0]!;

  const setField = useCallback((key: keyof SetupFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: normalizeField(key, value) }));
  }, []);

  const pickProvider = useCallback((id: string) => {
    const p = SETUP_PROVIDERS.find((x) => x.id === id) ?? SETUP_PROVIDERS[0]!;
    setForm((prev) => ({ ...prev, aiProvider: p.id, aiModel: p.defaultModel }));
  }, []);

  const next = useCallback(() => {
    setError(null);
    const v = validateStepAdvance(step, form);
    if (v !== null) { setError(v); return; }
    setStep((s) => toStep(Math.min(4, s + 1)));
  }, [step, form]);

  const back = useCallback(() => {
    setError(null);
    setStep((s) => toStep(Math.max(1, s - 1)));
  }, []);

  const submit = useCallback(async (): Promise<ClaimResult | null> => {
    setError(null);
    setBusy(true);
    try {
      return await claim({
        token: setupToken,
        email: form.email.trim(),
        password: form.password,
        handle: form.handle,
        full_name: form.full,
        public_url: normalizePublicURL(form.publicUrl),
        // F-H-2: the key collected in step 3 used to stop right here —
        // this line didn't used to exist, so the review card still showed
        // the provider and claim still succeeded, while the key never
        // landed anywhere.
        ai_provider: form.aiProvider,
        ai_model: form.aiModel,
        ai_key: form.aiKey.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'claim failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [form, setupToken]);

  const canAdvance = stepCanAdvance(step, form);

  return {
    step, form, error, busy, canAdvance, provider,
    setField, pickProvider, next, back, submit,
  };
}

// stepCanAdvance —— the real-time check that disables PrimaryBtn. Step 1
// checks the three required identity fields + that the url is http; step 2
// checks that password/confirm are filled and match; step 3 always allows
// advancing (key can be empty, filled in later on the review step); step 4
// is just review, submittable at any time.
function stepCanAdvance(step: SetupStep, f: SetupFormState): boolean {
  if (step === 1) return identityComplete(f);
  if (step === 2) return credentialsComplete(f);
  return true;
}

function identityComplete(f: SetupFormState): boolean {
  return f.full.trim() !== '' && f.handle !== '' && isHTTPURL(f.publicUrl);
}

function credentialsComplete(f: SetupFormState): boolean {
  return f.email.trim() !== '' && f.password !== '' && f.passwordConfirm !== '';
}

function initialState(): SetupFormState {
  return {
    full: '', handle: '', publicUrl: '',
    email: '', password: '', passwordConfirm: '',
    aiProvider: 'anthropic', aiKey: '', aiModel: SETUP_PROVIDERS[0]!.defaultModel,
  };
}

function normalizeField(key: keyof SetupFormState, value: string): string {
  if (key === 'handle') return value.toLowerCase().replace(HANDLE_PATTERN, '');
  return value;
}

function validateStepAdvance(step: SetupStep, f: SetupFormState): string | null {
  if (step === 1) return validateIdentity(f);
  if (step === 2) return validateCredentials(f);
  if (step === 3) return validateProvider(f);
  return null;
}

function validateIdentity(f: SetupFormState): string | null {
  if (f.full.trim() === '') return 'full name required';
  if (f.handle === '') return 'handle required';
  if (!isHTTPURL(f.publicUrl)) return 'public URL must start with http:// or https://';
  return null;
}

function validateCredentials(f: SetupFormState): string | null {
  if (f.email.trim() === '' || f.password === '') return 'email + password required';
  if (f.password.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  if (f.password !== f.passwordConfirm) return 'passwords don’t match';
  return null;
}

function validateProvider(f: SetupFormState): string | null {
  const p = SETUP_PROVIDERS.find((x) => x.id === f.aiProvider) ?? SETUP_PROVIDERS[0]!;
  if (!p.needsKey) return null;
  if (f.aiKey.trim() === '') return null; // empty key = skip, can be filled in later from the admin panel
  if (f.aiKey.trim().length < 8) return 'that key looks too short';
  return null;
}

// handleSetupSubmit —— dispatches SetupForm's form submit: step < 4 → next;
// step 4 → submit claim and navigate to admin.
export async function handleSetupSubmit(
  form: SetupFormHook,
  push: (path: string) => void,
): Promise<void> {
  if (form.step < 4) {
    form.next();
    return;
  }
  const result = await form.submit();
  if (result !== null) push('/admin');
}

function isHTTPURL(s: string): boolean {
  const t = s.trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

function normalizePublicURL(s: string): string {
  let t = s.trim();
  while (t.endsWith('/')) t = t.slice(0, -1);
  return t;
}

const VALID_STEPS: readonly SetupStep[] = [1, 2, 3, 4];
function toStep(n: number): SetupStep {
  return VALID_STEPS.find((s) => s === n) ?? 1;
}
