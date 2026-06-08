// session-strip.spec.ts —— visitor chat-capable surface 的 SessionStrip
// (top sticky 单源 session 状态条) + Quota gauge + 跨 surface + 坏码回落。
//
// 业务故事：
//   1. recruiter 扫 QR (/?code=X) → 名字选择器 → 进来后 SessionStrip 出现:
//      code 标签 + gauge 0/MAX turns。URL 上的 ?code= 在 absorb 后立刻删掉。
//   2. SessionStrip 跨 surface sticky(root / writings)。
//   3. 坏码 → 名字选择器 → 提交 401 → 回落 public,strip 不渲。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'strip-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'stripowner',
  fullName: 'Strip Owner',
};

const QUOTA_MAX = 5;
const VISITOR_CODE = 'STRIP-Q5';

test.describe('SessionStrip · gauge / cross-surface / invalid', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithQuotaCode(playwright);
  });

  test('enter via code → strip renders code + 0/max gauge; URL stripped',
    async ({ page }) => {
      await enterCodeSession(page, VISITOR_CODE);
      const strip = page.getByTestId('session-strip');
      await expect(strip).toBeVisible({ timeout: 5_000 });
      expect(page.url()).not.toMatch(/[?&]code=/);
      const gauge = page.getByTestId('session-strip-gauge');
      await expect(gauge).toContainText('0');
      await expect(gauge).toContainText(String(QUOTA_MAX));
    });

  test('strip mounts on /writings (cross-surface)',
    async ({ page }) => {
      await enterCodeSession(page, VISITOR_CODE);
      await goto(page, '/writings');
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('invalid code → picker → submit fails (401) → no strip (public tier)',
    async ({ page }) => {
      await goto(page, '/');
      await page.evaluate(() => window.localStorage.clear());
      await goto(page, '/?code=BOGUS-XYZ');
      await expect.poll(() => page.url(), { timeout: 3_000 }).not.toMatch(/[?&]code=/);
      const skip = page.getByTestId('visitor-name-skip');
      await expect(skip).toBeVisible({ timeout: 5_000 });
      await skip.click();
      await expect(page.getByTestId('session-strip')).toHaveCount(0, { timeout: 5_000 });
    });
});

async function initOwnerWithQuotaCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedQuotaCode(request);
  await request.dispose();
}

async function seedQuotaCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'strip-seed-token');
  await initMCP(request, apiToken);
  await createCode(request, csrf, {
    code: VISITOR_CODE,
    label: 'Strip quota test',
    max_turns_per_session: QUOTA_MAX,
  });
}
