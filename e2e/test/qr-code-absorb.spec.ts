// qr-code-absorb.spec.ts -- a recruiter scans the QR on a PDF (URL = `/?code=ABC`) ->
// lands on root -> `?code=` gets absorbed into the zustand store immediately + stripped
// from the URL + the session token lands in localStorage + the banner switches to the
// 'invited (code)' tier.
//
// Security significance: a plaintext access code must never stay in the URL / history /
// screenshot / referer; a visitor who scans the QR sees a URL that's already the clean
// `/` at first glance.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto, enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'qr-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'qrowner',
  fullName: 'QR Owner',
};

const VISITOR_CODE = 'QR-001';

test.describe('QR `?code=` is absorbed into store + stripped from URL', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithCode(playwright);
  });

  test('lands on /?code=QR-001 → URL stripped + picker pops; skip → session + strip',
    async ({ page }) => {
      await goto(page, '/?code=' + VISITOR_CODE);

      // 1. The URL is cleaned up immediately (?code= never stays in the
      //    URL/history/screenshot).
      await expect.poll(() => page.url(), { timeout: 5_000 })
        .not.toMatch(/[?&]code=/);
      expect(page.url()).toMatch(/\/$/);

      // 2. defer-issue: no session issued yet at this point; the name picker pops first.
      const skip = page.getByTestId('visitor-name-skip');
      await expect(skip).toBeVisible({ timeout: 5_000 });

      // 3. skip -> only now does issueCodeSession fire; session + strip come up.
      const sessionsCall = page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.request().method() === 'POST'
        && res.status() === 200);
      await skip.click();
      await sessionsCall;
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // 4. localStorage has visitor-session (byoai=false).
      const stored = await page.evaluate(() =>
        window.localStorage.getItem('standmeet:visitor-session'));
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as { session_token: string; byoai: boolean };
      expect(parsed.session_token.length).toBeGreaterThan(0);
      expect(parsed.byoai).toBe(false);
    });

  test('reload on / (no code in URL) → 不会重复 issue session；banner 仍是 code',
    async ({ page }) => {
      // First simulate "the code has already been absorbed": the user lands on
      // /?code=QR-001 -> now reload to a clean URL.
      await enterCodeSession(page, VISITOR_CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible();

      // Reload now to the clean URL and check it doesn't fire another sessions POST.
      let extraCalls = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().endsWith('/api/v1/sessions')) {
          extraCalls++;
        }
      });
      await goto(page, '/');
      // The banner re-mounting means the mount cycle ran to completion, so extraCalls
      // must be at its final value by now (there's no setTimeout / debounce code path
      // that would delay a POST).
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      expect(extraCalls).toBe(0);
    });

  test('invalid `?code=BOGUS` → URL 清干净;提交后 401 → 回落 public(无 strip)',
    async ({ page }) => {
      await goto(page, '/');
      await page.evaluate(() => window.localStorage.clear());

      await goto(page, '/?code=BOGUS-NOPE');
      // code= is cleared from the URL (absorb still happens, it just doesn't issue
      // right away).
      await expect.poll(() => page.url(), { timeout: 5_000 })
        .not.toMatch(/[?&]code=/);

      // The name picker pops; skip -> issueCodeSession (bad code) -> 401 -> drops the
      // pending code and falls back to public.
      const skip = page.getByTestId('visitor-name-skip');
      await expect(skip).toBeVisible({ timeout: 5_000 });
      await skip.click();

      // No session -> the strip doesn't render; the name picker is also gone (the
      // pending code has been consumed).
      await expect(page.getByTestId('session-strip')).toHaveCount(0, { timeout: 5_000 });
      await expect(skip).toBeHidden({ timeout: 5_000 });
    });
});

async function initOwnerWithCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedCode(request);
  await request.dispose();
}

async function seedCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // Starting an MCP session is just to exercise the owner-side state end to end;
  // createCode itself doesn't need it.
  const apiToken = await createAPIToken(request, csrf, 'qr-seed-token');
  await initMCP(request, apiToken);
  await createCode(request, csrf, {
    code: VISITOR_CODE,
    label: 'QR scan code',
  });
}
