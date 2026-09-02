// integration-writing-chat-flow.spec.ts -- writings → chat integration:
// owner publishes writing -> visitor sees it -> AskAboutThis -> a no-code hand-off to
// /gate -> a code fills the gate -> ChatRoom auto-asks the carried question -> the
// answer cites the corpus.
//
// User story:
//   owner posts a writing -> visitor sees it on /writings -> opens the article ->
//   clicks the AskAboutThis starter -> /?q=... -> root consumes it (no session) and
//   hands off to /gate?q= -> a code fills the gate and enters the session -> ChatRoom
//   auto-asks the carried question -> the answer lands in answer-body (the whole chain
//   matches coded-ask-continues, just starting from an article instead of the homepage).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
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

const CODE = 'WRITINGCHAT-1';

test.describe('writing → chat flow integration', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('visitor reads writing → AskAboutThis → /gate → 填码 → auto-ask → answer',
    async ({ page }) => {
      await goto(page, '/writings/writing-chat-test');
      await expect(page.getByTestId('writing-article-title'))
        .toHaveText('Writing Chat Test');

      // Click AskAboutThis starter
      const starter = page.locator('a[href^="/?q="]').first();
      await expect(starter).toBeVisible({ timeout: 5_000 });
      await starter.click();

      // A no-session visitor: root consumes ?q= and hands off to /gate (carrying ?q=).
      await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });

      // Filling a code at the gate: the session starts, ?q= carries back through to /,
      // and ChatRoom auto-asks the carried question.
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Reader');
      await page.getByTestId('gate-code-submit').click();

      // Answer should appear (auto-asked carried question)
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 20_000 });
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
  // The gate code carries a role that can read the corpus, so the answer after
  // entering can cite the wiki.
  const role = await createRole(request, csrf, {
    name: 'full', description: 'wiki://**', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'writingchat', assumed_role_id: role.id });
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
    cover_headline: 'writing.', cover_hue: 'amber',
    tags: ['integration'], publish: true,
  });
}
