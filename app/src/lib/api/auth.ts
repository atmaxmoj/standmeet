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
