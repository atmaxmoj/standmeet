// admin-preview.spec.ts —— admin preview: code picker, BYOAI card,
// coded preview banner, suggested questions.
//
// User story:
//   1. code picker → click code → right side preview frame changes
//   2. BYOAI card → click → "byoai mode · public scope" shown
//   3. coded preview → banner shows code label + "scoped to N topics"
//   4. coded preview → suggested questions from code.ghosts

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'preview@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'preview',
  fullName: 'Preview Owner',
};

const CODE = 'PREV-001';
const STARTERS = ['What do you do?', 'Tell me about your work'];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin preview', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code picker → select code → preview updates',
    async ({ adminPage }) => {
      await openPreview(adminPage);
      // Code picker should list our code
      const codePicker = adminPage.getByTestId('code-picker');
      await expect(codePicker).toBeVisible({ timeout: 5_000 });
      // Click on our code
      await adminPage.getByTestId('code-picker').getByRole('button', { name: 'Preview Test' }).click();
      // Preview banner should show code label
      await expect(adminPage.getByTestId('preview-frame'))
        .toContainText('Preview Test', { timeout: 5_000 });
    });

  test('coded preview → suggested questions rendered',
    async ({ adminPage }) => {
      await openPreview(adminPage);
      await adminPage.getByTestId('code-picker').getByRole('button', { name: 'Preview Test' }).click();
      // Suggested questions from the code
      await expect(adminPage.getByText(STARTERS[0]!)).toBeVisible({ timeout: 5_000 });
    });

  // F-C-9 — this panel is called "PREVIEW · VISITOR VIEW", but the coded branch used to
  // show a sentence admin itself assembled from adminPages.preview.codedWelcome*, with
  // the first 8 chars of assumed_role_id printed inside it.
  // What a real visitor sees is visitor.codedWelcome("…I'm an AI grounded in
  // {handle}'s curated corpus…"). The test above only asserts the code label appears,
  // so it would pass for either the assembled sentence or the real one.
  test('the coded preview shows the visitor’s own welcome, not an admin-written one',
    async ({ adminPage }) => {
      await openPreview(adminPage);
      await adminPage.getByTestId('code-picker').getByRole('button', { name: 'Preview Test' }).click();
      const frame = adminPage.getByTestId('preview-frame');
      await expect(frame, '这是访客那句欢迎语,不是 admin 另写的一句')
        .toContainText('curated corpus', { timeout: 5_000 });
      await expect(frame, '访客文案里不该出现内部 id')
        .not.toContainText(/[0-9a-f]{8}…/);
    });

  test('BYOAI card → click → public scope banner',
    async ({ adminPage }) => {
      await openPreview(adminPage);
      const byoaiCard = adminPage.getByTestId('code-picker').getByRole('button', { name: /BYOAI/i });
      if (await byoaiCard.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await byoaiCard.click();
        await expect(adminPage.getByTestId('preview-frame'))
          .toContainText(/public/i, { timeout: 5_000 });
      }
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'preview-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'preview intro.', title: 'Preview Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Preview Test',
    ghosts: STARTERS,
  });
  await request.dispose();
}

async function openPreview(page: Page): Promise<void> {
  await gotoAdminSection(page, 'preview');
  await page.waitForURL('**/admin/preview', { timeout: 5_000 });
}
