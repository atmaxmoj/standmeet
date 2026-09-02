// auth.ts —— admin auth API: claim (first-run) + login.
//
// claim takes the one-time setup token + owner profile; its side effect is
// adding a row to the owners table.
// login takes email + password; its side effect is a server-side session cookie.
//
// Both are client-side (the pages are 'use client'); same-origin with the
// backend, so the browser carries the cookie automatically.

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

export interface ClaimInput {
  token: string;
  email: string;
  password: string;
  handle: string;
  full_name: string;
  public_url: string;
  // The AI provider collected in wizard step 3, sent along with the same
  // claim request. Empty = that step was skipped.
  // endpoint isn't here — the server looks it up in its own preset table,
  // the frontend doesn't keep a second copy.
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
  // captcha_token is supplied by LoginForm only when the instance has Turnstile
  // installed; an empty string sends backend LoginGuard down the noop path
  // (no verification when the feature is off).
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

// recover —— #100 lets an owner locked out log back in with email + recovery
// phrase; on success the backend writes a session cookie (same as login). Goes
// through the public path (rate-limited by the same LoginGuard as login), no
// existing session required.
export async function recover(input: RecoverInput): Promise<LoginResult> {
  const res = await fetch('/api/admin/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'recover'));
  return safeJson(res, LoginResultSchema);
}

// ConfirmEmailResult —— result of confirming an email change. **Returns a
// discriminated value, doesn't throw** — the caller needs to say one of three
// different things based on code (changed / expired / this email wasn't meant
// for you), and readError only gives a single human-readable string, which
// can't distinguish between them. Collapsing three cases into one means the
// guidance meant for one of them can never surface.
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
  // Goes through a schema, not a type assertion: this response has two possible
  // shapes, and an assertion only silences the compiler — if the server changes
  // shape it would still sail through silently ([[zod-unknown-is-not-optional]]).
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

// resetPassword —— called by the /account/reset?t=... form; goes through the
// public path, no session cookie needed. The token itself is the credential.
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
