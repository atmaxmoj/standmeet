// code-session-paste.spec.ts — pasting a code into the gate auto-submits + the various
// error flows.
//
// User story:
//   1. visitor pastes a code into the gate input → auto-submits (no need to press enter)
//   2. an expired code → "code expired" message + points to /gate#request
//   3. an already-revoked code → "code revoked" message
//   4. an empty code → button disabled

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'paste-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pasteowner',
  fullName: 'Paste Owner',
};

const VALID_CODE = 'PASTE-001';

test.describe('gate code paste + error flows', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithCode(playwright);
  });

  test('paste code into gate input triggers auto-submit',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      const codeInput = page.getByTestId('gate-code');
      // Real paste event (not fill): dispatch ClipboardEvent so onPaste fires
      await codeInput.focus();
      await codeInput.evaluate((el, code) => {
        const input = el as HTMLInputElement;
        input.value = code;
        const dt = new DataTransfer();
        dt.setData('text/plain', code);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
        input.dispatchEvent(ev);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, VALID_CODE);
      // auto-submit fires 50ms after paste → navigates to /
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('empty code → submit button disabled',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      const submitBtn = page.getByTestId('gate-code-submit');
      await expect(submitBtn).toBeDisabled();
    });

  test('revoked code → error message shown',
    async ({ page, playwright }) => {
      // Revoke the code via API
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await revokeCodeAPI(request, csrf, VALID_CODE);
      await request.dispose();

      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill(VALID_CODE);
      await page.getByTestId('gate-code-submit').click();
      await expect(page.getByTestId('code-panel').getByTestId('gate-error')).toBeVisible({ timeout: 5_000 });
    });
});

async function initOwnerWithCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'paste-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'paste owner intro content.',
    title: 'Paste Owner Intro',
  });
  await createCode(request, csrf, {
    code: VALID_CODE,
    label: 'Paste test code',
  });
  await request.dispose();
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function revokeCodeAPI(
  request: APIRequestContext, csrf: string, code: string,
): Promise<void> {
  // List codes to find the ID
  const listRes = await request.get(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const codes = await listRes.json() as Array<{ id: string; code: string }>;
  const target = codes.find((c) => c.code === code);
  if (!target) throw new Error(`code ${code} not found`);
  const res = await request.post(`${BACKEND}/api/admin/codes/${target.id}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`revoke failed: ${res.status()}`);
}
