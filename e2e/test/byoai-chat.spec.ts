// byoai-chat.spec.ts —— a visitor brings their own API key through the BYOAI path.
//
// User story:
//   A stranger with no invite code, but their own Anthropic key, wants to try chatting
//   with the owner's public corpus. On /alice/gate's BYOAI panel they pick Anthropic and
//   fill in a key (a fake key for the test; the backend falls back to the mock provider)
//   → land on /alice?byoai=1 → see the BYOAI banner → chat streams a normal reply.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const FAKE_KEY = 'sk-ant-fake-test-key-for-byoai-flow';
const MOCK_REPLY = 'Hello visitor, alice says hi from the mock provider.';

test.describe('visitor brings own API key (BYOAI) via gate page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedPublic(request);
    await request.dispose();
  });

  test('byoai submission lands visitor on /<handle>?byoai=1 with banner + working chat',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await submitBYOAI(page);
      await expectLandedWithBanner(page);
      await visitorChats(page);
    });
});

async function seedPublic(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'byoai-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'alice loves ASCII sparklines.',
    title: 'Alice intro',
    tags: ['intro'],
  });
}

async function submitBYOAI(page: Page): Promise<void> {
  await expect(page.getByTestId('byoai-panel')).toBeVisible();
  await page.getByTestId('byoai-provider').selectOption('anthropic');
  // Override preset endpoint so backend hits the e2e llm-gateway sidecar
  // instead of real api.anthropic.com (which would 401 a fake test key).
  await page.getByTestId('byoai-endpoint').fill('http://llm-gateway:9300');
  await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
  await page.getByTestId('byoai-key').fill(FAKE_KEY);
  await page.getByTestId('byoai-submit').click();
}

async function expectLandedWithBanner(page: Page): Promise<void> {
  // BYOAI state lives in localStorage (use-gate persistSession) — no flag is attached
  // to the URL. On page-shell mount, it reads the visitor-session store, and
  // SessionStrip renders the is-byoai state (purple visitor-paid · unlimited).
  await page.waitForURL('**/', { timeout: 10_000 });
  const strip = page.getByTestId('session-strip');
  await expect(strip).toBeVisible({ timeout: 5_000 });
  await expect(strip).toContainText(/byoai/i);
}

async function visitorChats(page: Page): Promise<void> {
  // The new AskInput is an <input>, not a <textarea>; pressing Enter submits the form.
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill('tell me about you');
  await input.press('Enter');
  // ConversationDeck hangs the reply on data-testid="answer-body".
  await expect(page.locator('[data-testid="answer-body"]'))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(MOCK_REPLY, { exact: false }))
    .toBeVisible({ timeout: 15_000 });
}
