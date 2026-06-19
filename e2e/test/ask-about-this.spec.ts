// ask-about-this.spec.ts —— blog/[slug] / wiki / output 文末的 AskAboutThis
// follow-up 输入条 → 跳 `/?q=...` → root 自动 consume + 喂进 chat。
//
// 设计意图：visitor 看完一篇文章，"想继续问" 时不必返回首页再 type，
// 文末 inline 直接 starter prompt + 自定义 question。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'ask-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'askowner',
  fullName: 'Ask Owner',
};

test.describe('AskAboutThis · follow-up bar on blog/[slug]', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithWriting(playwright);
  });

  test('writing article shows starter prompts → click → goto / with ?q=...',
    async ({ page }) => {
      await goto(page, '/writings/eval-is-the-product');
      const form = page.getByTestId('article-ask-form');
      await expect(form).toBeVisible({ timeout: 5_000 });
      // click first "try" starter
      const starter = page.locator('a[href^="/?q="]').first();
      await expect(starter).toBeVisible();
      const href = await starter.getAttribute('href');
      expect(href).toMatch(/^\/\?q=/);
      // q param 是 encoded question 文本，含 "eval is the product" 标题片段
      expect(decodeURIComponent(href!)).toMatch(/eval is the product/i);
    });

  test('custom question submit → action="/" GET fires → 无码 hand off 到 /gate(带 ?q=)',
    async ({ page }) => {
      await goto(page, '/writings/eval-is-the-product');
      // 输自定义 → 提交 form (GET / with q=...)
      const input = page.locator('input[name="q"]');
      await input.fill('how did you build the eval rubric?');
      // form 是 method=get action=/ → 落 /?q=,root 的 useConsumeQuestionFromURL
      // 消费后,无 session 访客一律 hand off 到 /gate(485bf66),问题用 ?q= 串过去。
      await input.press('Enter');
      await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });
      await expect(page.getByTestId('code-panel')).toBeVisible();
    });
});

async function initOwnerWithWriting(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'ask-seed-token');
  const sid = await initMCP(request, apiToken);
  await callTool<{ writing_id: string }>(request, apiToken, sid, 'writing_create', {
    slug: 'eval-is-the-product',
    title: 'Eval is the product',
    excerpt: 'How retrieval-quality moves with rubric reframes.',
    body_md: 'half of the launch gain was rubric, not modeling.',
    cover_headline: 'eval.', cover_sub: 'is the product.', cover_hue: 'amber',
    tags: ['eval', 'retrieval'], publish: true,
  });
  await request.dispose();
}
