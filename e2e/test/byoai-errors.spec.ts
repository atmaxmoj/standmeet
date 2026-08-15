// byoai-errors.spec.ts —— BYOAI error flows: empty key, bad format, private topic.
//
// 用户故事：
//   1. BYOAI 空 key 提交 → 按钮 disabled
//   2. BYOAI key 格式错 → client-side 提示
//   3. BYOAI visitor 问 private topic → "need a code" 响应

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'byoai-err@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'byoaierr',
  fullName: 'Byoai Error',
};

test.describe('BYOAI error flows', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('empty API key → submit button disabled',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      // key is empty
      const submitBtn = page.getByTestId('byoai-submit');
      await expect(submitBtn).toBeDisabled();
    });

  // 上一版这条用例叫「invalid key format → client-side error shown」，而它 race 了两个
  // `.catch(() => null)` 之后**什么都不断言** —— 发生什么它都绿（[[assertion-that-cannot-fail]]）。
  // 名字还说产品会做客户端格式校验，实际不做：`presets.ts:27` 把 keyPrefix 注释成
  // 「sanity check」，但全仓没有一处检查它 —— 声明了一个没人接的位子（F-O-4）。
  //
  // 判据两条，缺一不可：形状不像时**说一句**（访客能在填的那一格就发现，而不是三步之后
  // 第一轮推理才失败）；同时**不许拦** —— 自建端点的 key 可以长成任何样子，把提示做成硬拦
  // 会挡住合法配置，那比现在更糟。
  test('key that does not look like the provider’s → a hint, and still submittable',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('not-a-valid-key');

      await expect(
        page.getByTestId('byoai-key-hint'),
        'the panel knows what an Anthropic key looks like — say it here, not after the first turn',
      ).toContainText('sk-ant-', { timeout: 5_000 });
      await expect(
        page.getByTestId('byoai-submit'),
        'a hint is not a gate: a self-hosted endpoint may issue any shape of key',
      ).toBeEnabled();
    });

  test('key that matches the provider’s shape → no hint at all',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-looks-right');
      // 正对照：不然「一直显示提示」也能让上面那条过。
      await expect(page.getByTestId('byoai-key-hint')).toHaveCount(0);
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
  const apiToken = await createAPIToken(request, csrf, 'byoai-err-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    body: 'public byoai content.', title: 'Public Intro', path: 'public/intro',
  });
  await request.dispose();
}
