// byoai-chat.spec.ts —— 访客带自己的 API key 走 BYOAI 路径。
//
// 用户故事：
//   一个陌生访客没 invite code，但有自己 Anthropic key 想试聊 owner 的
//   public corpus。在 /alice/gate BYOAI panel 选 Anthropic + 填 key（test
//   用 fake key；后端 mock provider 兜底）→ 跳 /alice?byoai=1 → 看到
//   BYOAI banner → chat 流式回复正常。

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
  // BYOAI 状态走 localStorage（use-gate persistSession），URL 上不挂 flag。
  // page-shell mount 时读 visitor-session store → SessionStrip 渲 is-byoai
  // 状态（紫色 visitor-paid · unlimited）。
  await page.waitForURL('**/', { timeout: 10_000 });
  const strip = page.getByTestId('session-strip');
  await expect(strip).toBeVisible({ timeout: 5_000 });
  await expect(strip).toContainText(/byoai/i);
}

async function visitorChats(page: Page): Promise<void> {
  // 新 AskInput 是 <input>，不是 <textarea>；按 Enter 提交 form。
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill('tell me about you');
  await input.press('Enter');
  // ConversationDeck 把回复挂在 data-testid="answer-body" 里。
  await expect(page.locator('[data-testid="answer-body"]'))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(MOCK_REPLY, { exact: false }))
    .toBeVisible({ timeout: 15_000 });
}
