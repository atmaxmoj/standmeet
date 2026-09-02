// gate-access.spec.ts — a visitor without a code, entering by typing one on /<handle>/gate.
//
// User story:
//   HR receives an access code in the owner's email but doesn't know the public page URL
//   directly. She visits /alice/gate, enters INTRO-001, gets taken to /alice, and can chat
//   against the work-tagged slice.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from "@playwright/test";

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

test.describe('visitor uses a gate code to enter a private page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedAndIssueCode(request);
    await request.dispose();
  });

  test('typing code on /<handle>/gate lands visitor on /<handle>',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await expect(page.getByTestId('code-panel')).toBeVisible();
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Sarah (HR)');
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      // A coded visitor now sees ChatRoom (focused chat), not the long-scroll page.
      // Verify session-strip is visible + chat input is visible.
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });
});

async function seedAndIssueCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'I built FlexMesh for Canadian delivery drivers.',
    title: 'Work — FlexMesh',
    tags: ['work'],
  });
  await createCode(request, csrf, {
    code: CODE,
    label: 'Intro for HR',
    purpose: 'gate spec',
  });
}
