// integration-code-chat-transcript.spec.ts —— full flow: owner creates code →
// visitor uses code → chats → owner sees transcript in admin.
//
// 用户故事：
//   owner 创 code → visitor 用 code 进 ChatRoom → 聊几轮 → owner 在
//   /admin/conversations 看到 transcript + cited bodies

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'integ-chat@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'integchat',
  fullName: 'Integration Chat Owner',
};

const CODE = 'INTEG-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('code → chat → transcript integration', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('visitor chats with code → owner sees transcript in admin',
    async ({ page, adminPage }) => {
      // Visitor absorbs code and chats
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // Skip name if picker appears
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      // Send a message
      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('tell me about integration testing');
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });

      // Owner checks conversations in admin
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.waitForURL('**/admin/conversations', { timeout: 5_000 });
      // Should see the conversation
      await expect(adminPage.getByTestId('conv-table')).toBeVisible();
      // Click on the first conversation row to expand transcript
      const row = adminPage.getByTestId('conv-table').locator('tbody tr').first();
      await expect(row).toBeVisible({ timeout: 5_000 });
      await row.click();
      // Transcript should contain the visitor's message
      await expect(adminPage.getByTestId('transcript-panel'))
        .toContainText('integration testing', { timeout: 5_000 });
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
  const token = await createAPIToken(request, csrf, 'integ-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, {
    body: 'integration chat intro content.', title: 'Integration Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Integration test code',
  });
  await request.dispose();
}
