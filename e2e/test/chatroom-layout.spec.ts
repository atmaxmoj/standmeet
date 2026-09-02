// chatroom-layout.spec.ts —— switching between ChatRoom and long-scroll.
//
// User story:
//   1. public visitor (no session) → long-scroll (Hero + Insights + Projects + Where + Contact)
//   2. coded visitor → ChatRoom (slim header + welcome + composer) — never sees long-scroll
//   3. BYOAI visitor → ChatRoom (BYOAI mode welcome)
//   4. long-scroll (no code) visitor asks a question → no inline answer, hands off to /gate (with ?q=)

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'layout-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'layoutowner',
  fullName: 'Layout Owner',
};

const CODE = 'LAYOUT-001';

test.describe('ChatRoom layout switching', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public visitor sees long-scroll sections',
    async ({ page }) => {
      // Stable signals for long-scroll (not ChatRoom): the hero name + the contact section
      // (chat_line always has content by default, so it always renders) + the chat input.
      // insights/projects/where are sections that hide entirely when empty
      // (docs/design/page-corpus-pinning.md + F-A-21); their rendering is covered by their own tests.
      await expect(page.getByText('Layout Owner')).toBeVisible();
      await expect(page.getByText('how to talk to me')).toBeVisible();
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });

  test('coded visitor sees ChatRoom, not long-scroll',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
      await expect(page.getByTestId('chat-welcome')).toBeVisible();
    });

  test('BYOAI visitor sees ChatRoom with BYOAI welcome',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-fake-layout');
      await page.getByTestId('byoai-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-welcome')).toBeVisible();
      await expect(page.getByTestId('chat-welcome')).toContainText(/public/i);
    });

  test('public visitor asks question → 不行内答,hand off 到 /gate(带 ?q=)',
    async ({ page }) => {
      // A no-code visitor asking a question on long-scroll gets no inline answer (485bf66):
      // it always jumps to /gate, carrying the question via ?q=, and only answers it in
      // ChatRoom once the visitor gets past the gate (see coded-ask-continues for the full chain).
      // The question field on the home page is named `home-ask-field`, not ChatRoom's
      // `chat-input-field`: 5e439b51 deliberately gave them different names (one name, two
      // behaviors — Enter here means "hand off," Enter there means "send a message").
      // That rename only reached the product code; these cases were left pointing at the old
      // name and stayed red for two days with nobody noticing — nobody ran the full suite in that window.
      const input = page.locator('[data-testid="home-ask-field"]');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });
      await expect(page.getByTestId('code-panel')).toBeVisible();
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
  const apiToken = await createAPIToken(request, csrf, 'layout-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'layout owner intro.', title: 'Layout Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Layout test',
  });
  await request.dispose();
}
