// ask-about-this.spec.ts — the AskAboutThis follow-up input bar at the end of a
// blog/[slug] / wiki / output article → navigates to `/?q=...` → root auto-consumes it
// and feeds it into chat.
//
// Design intent: when a visitor finishes an article and wants to keep asking, they
// shouldn't have to go back to the homepage and type — the article footer offers an
// inline starter prompt plus a custom question, right there.

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
      // the q param is the encoded question text, containing the "eval is the product"
      // title fragment
      expect(decodeURIComponent(href!)).toMatch(/eval is the product/i);
    });

  test('custom question submit → action="/" GET fires → 无码 hand off 到 /gate(带 ?q=)',
    async ({ page }) => {
      await goto(page, '/writings/eval-is-the-product');
      // type a custom question → submit the form (GET / with q=...)
      const input = page.locator('input[name="q"]');
      await input.fill('how did you build the eval rubric?');
      // the form is method=get action=/ → lands on /?q=; root's useConsumeQuestionFromURL
      // consumes it, then a sessionless visitor is always handed off to /gate (485bf66),
      // with the question carried along via ?q=.
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
    cover_headline: 'eval.', cover_hue: 'amber',
    tags: ['eval', 'retrieval'], publish: true,
  });
  await request.dispose();
}
