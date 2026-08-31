// auth.ts —— admin auth API：claim (first-run) + login。
//
// claim 拿一次性 setup token + owner profile，副作用是 owners 表加一行。
// login 拿 email + password，副作用是 server-side session cookie。
//
// 都是 client-side（pages 是 'use client'）；和 backend 同源 origin，浏览器
// 自动带 cookie。

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

export interface ClaimInput {
  token: string;
  email: string;
  password: string;
  handle: string;
  full_name: string;
  public_url: string;
  // 向导第 3 步收的 AI provider，跟 claim 同一次请求送过去。留空 = 那一步跳过了。
  // endpoint 不在这里 —— 服务端从自己的 preset 表查，前端不编第二份。
  ai_provider: string;
  ai_model: string;
  ai_key: string;
}

const ClaimResultSchema = z.object({
  owner_id: z.string(), email: z.string(), handle: z.string(),
  full_name: z.string(), public_url: z.string(),
});
export type ClaimResult = z.infer<typeof ClaimResultSchema>;

export async function claim(input: ClaimInput): Promise<ClaimResult> {
  const res = await fetch('/api/admin/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'claim'));
  return safeJson(res, ClaimResultSchema);
}

export interface LoginInput {
  email: string;
  password: string;
  // captcha_token 仅在 instance 装了 Turnstile 时由 LoginForm 提供；空 string
  // 让 backend LoginGuard 走 noop 路径（feature off 时不验）。
  captcha_token?: string;
}

const LoginResultSchema = z.object({
  csrf_token: z.string(), owner_id: z.string(), owner_handle: z.string(),
});
export type LoginResult = z.infer<typeof LoginResultSchema>;

export async function login(input: LoginInput): Promise<LoginResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.captcha_token) headers['X-Captcha-Token'] = input.captcha_token;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (!res.ok) throw new Error(await readError(res, 'login'));
  return safeJson(res, LoginResultSchema);
}

export interface RecoverInput {
  email: string;
  recovery_phrase: string;
}

// recover —— #100 锁在外面时用 email + recovery phrase 登回来；成功后 backend 写 session cookie
// (跟 login 一样)。走 public 路径(与 login 同套 LoginGuard 限速),不需要既有 session。
export async function recover(input: RecoverInput): Promise<LoginResult> {
  const res = await fetch('/api/admin/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'recover'));
  return safeJson(res, LoginResultSchema);
}

// ConfirmEmailResult —— 确认改邮箱的结果。**返回判别值，不抛** ——
// 调用方要按 code 说三句不同的话（换好了 / 过期了 / 这封信不是给你的），
// 而 readError 只给一句人话字符串，分辨不出来。把三类压成一类，
// 为其中一类准备的那句指引就永远出不来。
export type ConfirmEmailResult =
  | { ok: true; email: string }
  | { ok: false; code: string };

const ConfirmEmailBodySchema = z.object({
  email: z.string().optional(),
  error: z.object({ code: z.string().optional() }).optional(),
});

export async function confirmEmail(token: string): Promise<ConfirmEmailResult> {
  const res = await fetch('/api/admin/confirm-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  // 走 schema 而不是类型断言：这个回执两种形状，而断言只是把编译器噤声，
  // 服务端换了形状照样静默走到底（[[zod-unknown-is-not-optional]]）。
  const parsed = ConfirmEmailBodySchema.safeParse(await res.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : {};
  return res.ok
    ? { ok: true, email: body.email ?? '' }
    : { ok: false, code: body.error?.code ?? '' };
}

export interface ResetPasswordInput {
  token: string;
  new_password: string;
}

// resetPassword —— /account/reset?t=... 表单调；走 public 路径不需要 session
// cookie。token 本身就是凭据。
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const res = await fetch('/api/v1/account/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'password reset'));
}

async function readError(res: Response, op: string): Promise<string> {
  try {
    const body = await safeJson(res, z.object({ error: z.object({ message: z.string().optional() }).optional() }));
    return body.error?.message ?? `${op} failed: ${res.status}`;
  } catch {
    return `${op} failed: ${res.status}`;
  }
}
