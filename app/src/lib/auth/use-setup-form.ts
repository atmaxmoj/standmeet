// use-setup-form —— first-run setup wizard 状态机。
//
// 设计源 docs/design/project/auth.js Setup。4-step：
//   1. identity      —— name + handle + publicUrl
//   2. credentials   —— email + password + confirm
//   3. ai provider   —— provider chip + key + model（可跳，admin 后台可补）
//   4. review        —— summary 卡 → claim
//
// Step 3 写到 admin/ai-provider PATCH（成功 claim 之后顺手调一次）。
//
// **step 4 曾经还有一道算术 captcha，已经删掉（F-H-1）。**
// 它是 client-only 的：`routes/admin/claim.go` 的 `claimRequest` 只有
// token/email/password/handle/full_name/public_url —— **后端从头到尾没见过那个答案**。
// 而真正的授权是**一次性 setup token**（打印在后端日志里，只有能读服务器的人拿得到），
// 所以 claim 连 loginGuard 都不套。
//
// 于是那道算术的收益是负的：能读到 token 的自动化当然会算加法，它一个 bot 都拦不住；
// 唯一拦住的是**合法的、owner 自己挂的 agent** —— 而这个产品的既定目标就是能被
// owner 的 AI 客户端纯自动驱动（job loop 整条链只有 MCP 一条路，正是这个设计）。
//
// **删的只是这一道装饰。** 对外的防护一层没动：gate / login 的 per-IP 锁定、
// 以及后端 turnstile（如开启）都还在 —— 那些是服务端真的会验的。
//
// 业务规则：
//   - step 1：name + handle + publicUrl 必填，handle 只允许 [a-z0-9-]
//   - step 2：email + password + confirm，password ≥ 8，两次输入一致
//   - step 3：选了 provider 必须有 key（ollama 例外，本地无 key）；可整步跳过
//   - step 4：只是复核 summary 卡，随时可以提交
//
// 摆 lib/ 是因为 components/ + app/**/*.tsx 禁 `if`，wizard 的分支控制走 hook 干净。

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

// stepCanAdvance —— 实时禁用 PrimaryBtn 的判定。step 1 看 identity 三项
// 必填 + url 是 http；step 2 看 password/confirm 是否填且一致；step 3
// 总是允许（key 可空，跳到 review 现场补）；step 4 是复核，随时可提交。
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
  if (f.aiKey.trim() === '') return null; // key 留空 = 跳过，admin 后台可补
  if (f.aiKey.trim().length < 8) return 'that key looks too short';
  return null;
}

// handleSetupSubmit —— SetupForm form 提交分发：step < 4 → next；
// step 4 → submit claim 并跳 admin。
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
