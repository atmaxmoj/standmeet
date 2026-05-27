// turn-rendering.spec.ts —— chat turn 渲染: citations, pending, error, reset.
//
// 用户故事：
//   1. normal answer → serif body paragraphs + "ai" speaker label
//   2. answer with citations → "drawn from" block
//   3. pending → "retrieving" animation
//   4. error → error message (not blank)
//   5. reset → all turns clear + welcome re-appears

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'turn-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'turnowner',
  fullName: 'Turn Owner',
};

const CODE = 'TURN-001';

test.describe('turn rendering: citations, pending, error', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('answer renders with citations block',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      // Skip name picker if visible
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      // Pending indicator
      await expect(page.getByTestId('answer-pending'))
        .toBeVisible({ timeout: 5_000 });
      // Answer body
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      // Citations block
      await expect(page.locator('[data-testid="citations"]'))
        .toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-testid="citations"]'))
        .toContainText('drawn from');
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
  const apiToken = await createAPIToken(request, csrf, 'turn-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'turn owner loves building things.', title: 'Turn Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Turn render test',
  });
  await request.dispose();
}
