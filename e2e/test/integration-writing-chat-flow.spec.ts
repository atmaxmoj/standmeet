// integration-writing-chat-flow.spec.ts —— writings → chat integration:
// owner publishes writing → visitor sees it → AskAboutThis → ChatRoom auto-ask.
//
// 用户故事：
//   owner 发 writing → visitor 在 /writings 看到 → 点开文章 →
//   AskAboutThis → /?q=... → ChatRoom 自动 ask → answer 引用 corpus

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'writingchat@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'writingchat',
  fullName: 'Writing Chat Owner',
};

test.describe('writing → chat flow integration', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('visitor reads writing → AskAboutThis → /?q= → auto-ask → answer',
    async ({ page }) => {
      await goto(page, '/writings/writing-chat-test');
      await expect(page.getByTestId('writing-article-title'))
        .toHaveText('Writing Chat Test');

      // Click AskAboutThis starter
      const starter = page.locator('a[href^="/?q="]').first();
      await expect(starter).toBeVisible({ timeout: 5_000 });
      await starter.click();

      // Should navigate to / with ?q= param
      await page.waitForURL(/\/\?q=/, { timeout: 5_000 });

      // The q param gets consumed and auto-asked
      await expect.poll(() => page.url(), { timeout: 5_000 }).not.toMatch(/\?q=/);

      // Answer should appear (auto-asked)
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedContent(request);
  await request.dispose();
}

async function seedContent(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'writingchat-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, {
    body: 'writingchat owner builds amazing things.',
    title: 'WritingChat Intro',
  });
  await callTool(request, token, sid, 'writing_create', {
    slug: 'writing-chat-test',
    title: 'Writing Chat Test',
    excerpt: 'A writing to test writing-to-chat flow.',
    body_md: 'This writing explores the writing to chat integration.',
    cover_headline: 'writing.', cover_sub: 'chat.', cover_hue: 'amber',
    tags: ['integration'], publish: true,
  });
}
