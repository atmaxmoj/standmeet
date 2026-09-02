// code-self-test.spec.ts -- the owner tries a chat directly from the
// /admin/codes card.
//
// User story:
//   the owner doesn't want to open an incognito window to pretend to be a
//   visitor anymore. Click "preview" on the code card -> in the modal,
//   "test this code" -> starts a session (visitor_name = "(owner test)")
//   -> send a message -> watch the streamed reply.
//   /admin/conversations also shows this "(owner test)" conversation as proof.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'TEST-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner self-tests a code from /admin/codes preview', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeForTesting(request);
    await request.dispose();
  });

  test('preview modal opens, "test this code" runs a streaming reply',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'codes');
      await openPreviewModal(page);
      await runSelfTest(page, 'tell me about your work');
      await assertTestConversationLogged(page);
    });
});

async function issueCodeForTesting(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Self-test code',
    purpose: 'code-self-test spec',

  });
}

async function openPreviewModal(page: Page): Promise<void> {
  await page.getByTestId(`code-card-${CODE}`)
    .getByRole('button', { name: /preview/ }).click();
  await expect(page.getByText(/test this code/)).toBeVisible();
}

async function runSelfTest(page: Page, prompt: string): Promise<void> {
  await page.getByTestId('code-self-test-start').click();
  await expect(page.getByTestId('code-self-test-input')).toBeVisible();
  await page.getByTestId('code-self-test-input').fill(prompt);
  await page.getByTestId('code-self-test-send').click();
  // The mock provider settles after streaming out a few chunks; it's enough
  // for the reply to appear.
  await expect(page.getByTestId('code-self-test-reply')).toBeVisible({ timeout: 15_000 });
}

async function assertTestConversationLogged(page: Page): Promise<void> {
  // Close the preview modal, otherwise it blocks the sidebar link.
  await page.getByRole('button', { name: /close/ }).click();
  await gotoAdminSection(page, 'conversations');
  await page.waitForURL('**/admin/conversations', { timeout: 5_000 });
  // This conversation's visitor_name = "(owner test)" and should show up in the list.
  await expect(page.getByText('(owner test)')).toBeVisible();
}
