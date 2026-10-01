// captcha.ts —— turn the instance's login check on, the way the owner does: the system page's
// settings (PUT /api/admin/captcha), with Cloudflare's published always-pass test keys.
//
// These specs used to run only on a stack started with the Turnstile keys in env (`make
// test-captcha`) and skipped everywhere else. The owner moved that setting out of the deployment
// (2026-10-01): it is an owner setting now, so each spec turns it on for its own fresh instance and
// runs in the default suite.

import type { APIRequestContext } from '@playwright/test';

import { login } from '@/fixtures/admin';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// Cloudflare's published always-pass Turnstile test keys.
const TEST_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
const TEST_TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';

export async function turnCaptchaOn(
  request: APIRequestContext, owner: { email: string; password: string },
): Promise<void> {
  const { csrf } = await login(request, owner.email, owner.password);
  const res = await request.put(`${BACKEND}/api/admin/captcha`, {
    headers: { 'X-Csrftoken': csrf },
    data: { site_key: TEST_TURNSTILE_SITE_KEY, secret_change: 'set', secret: TEST_TURNSTILE_SECRET },
  });
  if (res.status() !== 200) throw new Error(`turn captcha on failed: ${res.status()} ${await res.text()}`);
}
