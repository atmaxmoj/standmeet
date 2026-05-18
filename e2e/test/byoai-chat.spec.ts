// byoai-chat.spec.ts —— 访客带自己的 API key 走 BYOAI 路径。
//
// 用户故事：
//   一个陌生访客没 invite code，但有自己 Anthropic key 想试聊 owner 的
//   public corpus。在 /sijie/gate BYOAI panel 选 Anthropic + 填 key（test
//   用 fake key；后端 mock provider 兜底）→ 跳 /sijie?byoai=1 → 看到
//   BYOAI banner → chat 流式回复正常。

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '../helper/admin';
import { seedPublicWiki } from '../helper/corpus';
import { resetInstance, findSetupToken } from '../helper/docker';
import { initMCP } from '../helper/mcp';
import { goto } from '../helper/navigate';

const OWNER = {
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sijie',
  fullName: 'Sijie Wang',
};

const FAKE_KEY = 'sk-ant-fake-test-key-for-byoai-flow';
const MOCK_REPLY = 'Hello visitor, sijie says hi from the mock provider.';

test.describe.serial('visitor brings own API key (BYOAI) via gate page', () => {
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
      await goto(page, `/${OWNER.handle}/gate`);
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
    body: 'sijie loves ASCII sparklines.',
    title: 'Sijie intro',
    tags: ['intro'],
  });
}

async function submitBYOAI(page: Page): Promise<void> {
  await expect(page.getByTestId('byoai-panel')).toBeVisible();
  await page.getByTestId('byoai-provider').selectOption('anthropic');
  await page.getByTestId('byoai-key').fill(FAKE_KEY);
  await page.getByTestId('byoai-submit').click();
}

async function expectLandedWithBanner(page: Page): Promise<void> {
  await page.waitForURL(/.*\/sijie\?byoai=1$/, { timeout: 10_000 });
  await expect(page.getByTestId('byoai-banner')).toBeVisible();
}

async function visitorChats(page: Page): Promise<void> {
  const input = page.locator('[data-testid="chat-input"] textarea');
  await input.fill('tell me about you');
  await input.press('Enter');
  await expect(page.getByText('reply', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(MOCK_REPLY, { exact: false })).toBeVisible({ timeout: 15_000 });
}
