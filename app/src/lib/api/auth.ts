// auth.ts —— admin auth API：claim (first-run) + login。
//
// claim 拿一次性 setup token + owner profile，副作用是 owners 表加一行。
// login 拿 email + password，副作用是 server-side session cookie。
//
// 都是 client-side（pages 是 'use client'）；和 backend 同源 origin，浏览器
// 自动带 cookie。

export interface ClaimInput {
  token: string;
  email: string;
  password: string;
  handle: string;
  full_name: string;
}

export interface ClaimResult {
  owner_id: string;
  email: string;
  handle: string;
  full_name: string;
}

export async function claim(input: ClaimInput): Promise<ClaimResult> {
  const res = await fetch('/api/admin/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'claim'));
  return await res.json() as ClaimResult;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  csrf_token: string;
  owner_id: string;
  owner_handle: string;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'login'));
  return await res.json() as LoginResult;
}

async function readError(res: Response, op: string): Promise<string> {
  try {
    const body = await res.json() as { error?: { message?: string } };
    return body.error?.message ?? `${op} failed: ${res.status}`;
  } catch {
    return `${op} failed: ${res.status}`;
  }
}
