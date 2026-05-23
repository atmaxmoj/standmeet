// admin.ts —— claim / login / API token 创建 helper（spec 共用）。
//
// 这些都属于"测试前置条件"，不是被测路径本身；放 helper 让 spec 短促。

import type { APIRequestContext, Page } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DEFAULT_PASSWORD = 'correct-horse-battery-staple';

export interface ClaimOptions {
  email?: string;
  password?: string;
  handle?: string;
  fullName?: string;
  publicUrl?: string;
}

// Default public_url for specs: the app port (38127) since recruiters land
// on the Next.js app. QR URL builder uses this from owners.public_url at
// commit time. Override per spec if exercising a different public host.
const DEFAULT_PUBLIC_URL = 'http://localhost:38127';

export async function claim(
  request: APIRequestContext,
  setupToken: string,
  opts: ClaimOptions = {},
): Promise<void> {
  const email = opts.email ?? 'alice@example.com';
  const password = opts.password ?? DEFAULT_PASSWORD;
  const handle = opts.handle ?? 'alice';
  const fullName = opts.fullName ?? 'Alice Anderson';
  const publicUrl = opts.publicUrl ?? DEFAULT_PUBLIC_URL;
  const res = await request.post(`${BACKEND}/api/admin/claim`, {
    data: {
      token: setupToken,
      email, password, handle, full_name: fullName, public_url: publicUrl,
    },
  });
  if (res.status() !== 200) throw new Error(`claim failed: ${res.status()}`);
}

export interface AdminLogin {
  csrf: string;
}

export async function login(
  request: APIRequestContext,
  email = 'alice@example.com',
  password = DEFAULT_PASSWORD,
): Promise<AdminLogin> {
  const res = await request.post(`${BACKEND}/api/admin/login`, { data: { email, password } });
  if (res.status() !== 200) throw new Error(`login failed: ${res.status()}`);
  const body = await res.json() as { csrf_token?: string };
  return { csrf: body.csrf_token ?? '' };
}

export async function createAPIToken(
  request: APIRequestContext,
  csrf: string,
  name = 'e2e-token',
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/tokens`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name },
  });
  if (res.status() !== 201 && res.status() !== 200) {
    throw new Error(`create token failed: ${res.status()}`);
  }
  const body = await res.json() as { plaintext?: string };
  return body.plaintext ?? '';
}

// navigateToOwnerLogin —— 把 page 带到 /login（owner 输 /admin → 自动 redirect）。
// 给 owner-login spec 测错密码停留在 /login 用。
export async function navigateToOwnerLogin(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.waitForURL('**/login', { timeout: 10_000 });
}
