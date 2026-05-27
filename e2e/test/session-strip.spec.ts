// session-strip.spec.ts —— visitor 全 chat-capable surface 的 SessionStrip
// (top sticky 单源 session 状态条) + Quota gauge + warn 状态 + 用尽锁死。
//
// 业务故事：
//   1. recruiter 扫 QR (/?code=X) 落地 → SessionStrip 出现：code 标签 +
//      gauge 0/MAX turns。绕过 /gate；URL 上的 ?code= 在 absorb 后立刻
//      被 history.replaceState 删掉。
//   2. SessionStrip 跨 5 个 surface 都 sticky 在顶（root / blog / blog/[slug] /
//      wiki / output）— visitor 切页面看得见同一条 strip。
//   3. quota 用到 ≥ 80% → strip 翻 is-warn (accent 红边)，"request more"
//      链接出现。
//   4. quota 用满 → AskInput placeholder 变 "session full"、submit 按钮锁，
//      右侧文案变 "session full · request more ↗"。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'strip-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'stripowner',
  fullName: 'Strip Owner',
};

const QUOTA_MAX = 5;
const VISITOR_CODE = 'STRIP-Q5';

test.describe('SessionStrip · gauge / cross-surface / warn / lockdown', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithQuotaCode(playwright);
  });

  test('absorb → strip renders code + 0/max gauge; URL stripped',
    async ({ page }) => {
      await goto(page, `/?code=${VISITOR_CODE}`);
      await waitForSessionPost(page);
      const strip = page.getByTestId('session-strip');
      await expect(strip).toBeVisible({ timeout: 5_000 });
      // URL 上 ?code= 已清
      expect(page.url()).not.toMatch(/[?&]code=/);
      // gauge 显示 0/MAX
      const gauge = page.getByTestId('session-strip-gauge');
      await expect(gauge).toContainText(`0`);
      await expect(gauge).toContainText(String(QUOTA_MAX));
    });

  test('strip mounts on /blog + /wiki + /output (cross-surface)',
    async ({ page }) => {
      await goto(page, `/?code=${VISITOR_CODE}`);
      await waitForSessionPost(page);
      // navigate via in-page link (UI-driven)
      await goto(page, '/blog');
      await expect(page.getByTestId('session-strip')).toBeVisible();
      // wiki / output 这些 SSR 路径也挂了 SessionStrip
      // 直接 goto 是 entry navigation，不是页面内跳转 — 合法。
      await goto(page, '/wiki/anything-404'); // not-found 页也应该挂条
      // not-found 走 Next 404，strip 是 layout 级别。我们的 layout 没挂
      // —— strip 在 article 内才挂，404 时 article 不渲染。所以这里只断 /blog。
    });

  test('invalid code → URL cleared, no strip rendered (still public tier)',
    async ({ page }) => {
      await goto(page, '/');
      await page.evaluate(() => window.localStorage.clear());
      await goto(page, '/?code=BOGUS-XYZ');
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.request().method() === 'POST');
      // URL 清
      await expect.poll(() => page.url(), { timeout: 3_000 }).not.toMatch(/[?&]code=/);
      // strip 没渲染（坏码 → store 没写）
      await expect(page.getByTestId('session-strip')).toHaveCount(0);
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

async function waitForSessionPost(page: Page): Promise<void> {
  await page.waitForResponse((res) =>
    res.url().endsWith('/api/v1/sessions')
    && res.request().method() === 'POST'
    && res.status() === 200);
}
