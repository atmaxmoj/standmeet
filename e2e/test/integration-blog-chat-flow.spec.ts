// integration-blog-chat-flow.spec.ts —— blog → chat integration:
// owner publishes post → visitor sees it → AskAboutThis → ChatRoom auto-ask.
//
// 用户故事：
//   owner 发 blog post → visitor 在 /blog 看到 → 点开文章 →
//   AskAboutThis → /?q=... → ChatRoom 自动 ask → answer 引用 corpus

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'blogchat@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blogchat',
  fullName: 'Blog Chat Owner',
};

test.describe('blog → chat flow integration', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('visitor reads blog → AskAboutThis → /?q= → auto-ask → answer',
    async ({ page }) => {
      await goto(page, '/blog/blog-chat-test');
      await expect(page.getByTestId('blog-article-title'))
        .toHaveText('Blog Chat Test Post');

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
  const token = await createAPIToken(request, csrf, 'blogchat-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, {
    body: 'blogchat owner builds amazing things.',
    title: 'BlogChat Intro',
  });
  await callTool(request, token, sid, 'post_create', {
    slug: 'blog-chat-test',
    title: 'Blog Chat Test Post',
    excerpt: 'A post to test blog-to-chat flow.',
    body_md: 'This post explores the blog to chat integration.',
    cover_headline: 'blog.', cover_sub: 'chat.', cover_hue: 'amber',
    tags: ['integration'], publish: true,
  });
}
