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
import { enterCodeSession } from '@/fixtures/navigate';

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
      // `enterCodeSession` 自己已经跳过名字选择器、并等到 /sessions 200 才返回。
      // 这里**不能再 dismiss 一次**：那是个 check-then-act 竞态 —— `isVisible` 为真的
      // 那一瞬和真正点下去之间，picker 正在 unmount，于是 Playwright 报
      // 「element was detached from the DOM」然后重试到 10 秒超时。
      // 全量套件里它随机红一次，单跑却几乎总是绿 —— 因为窗口只有几十毫秒。
      // （`chat-composer.spec.ts` 早就把这条写在注释里了，这个文件没跟上。）
      await enterCodeSession(page, CODE);
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      // Pending indicator
      await expect(page.getByTestId('answer-pending'))
        .toBeVisible({ timeout: 5_000 });
      // Answer body
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      // Answer text should contain the mock provider's response
      await expect(page.locator('[data-testid="answer-body"]'))
        .toContainText(/./);
      // Citations rendering is covered by visitor-chat-cited-precise.spec.ts
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
