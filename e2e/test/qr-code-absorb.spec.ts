// qr-code-absorb.spec.ts —— recruiter 扫 PDF 上的 QR (URL = `/?code=ABC`)
// → 落到 root → `?code=` 立刻被吸进 zustand store + 从 URL 删掉 +
// session token 落 localStorage + banner 切到 'invited (code)' 档。
//
// 安全意义：明文 access code 不能留在 URL/history/截图/referer 上；扫
// QR 的 visitor 一眼看到的 URL 已经是干净的 `/`。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'qr-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'qrowner',
  fullName: 'QR Owner',
};

const VISITOR_CODE = 'QR-001';

test.describe.serial('QR `?code=` is absorbed into store + stripped from URL', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithCode(playwright);
  });

  test('visitor lands on /?code=QR-001 → URL becomes / + coded banner shows',
    async ({ page }) => {
      // 监听 sessions POST，确认 absorb 确实触发了 issueCodeSession。
      const sessionsCall = page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.request().method() === 'POST'
        && res.status() === 200);

      await goto(page, '/?code=' + VISITOR_CODE);
      await sessionsCall;

      // 1. URL 被清干净（?code= 不应再在 URL 上）
      await expect.poll(() => page.url(), { timeout: 5_000 })
        .not.toMatch(/[?&]code=/);
      expect(page.url()).toMatch(/\/$/);

      // 2. coded banner 渲出（说明 tier 从 'public' 切到 'code'）
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // 3. localStorage 有 visitor-session（byoai=false）
      const stored = await page.evaluate(() =>
        window.localStorage.getItem('standmeet:visitor-session'));
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as { session_token: string; byoai: boolean };
      expect(parsed.session_token.length).toBeGreaterThan(0);
      expect(parsed.byoai).toBe(false);
    });

  test('reload on / (no code in URL) → 不会重复 issue session；banner 仍是 code',
    async ({ page }) => {
      // 先模拟"已经吸过 code"：用户 /?code=QR-001 落地 → 现在 reload 干净 URL
      await goto(page, '/?code=' + VISITOR_CODE);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible();

      // 现在 reload 到干净 URL，看不会再发 sessions POST
      let extraCalls = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().endsWith('/api/v1/sessions')) {
          extraCalls++;
        }
      });
      await goto(page, '/');
      // banner 重新挂出 = mount cycle 完整跑完，extraCalls 这时一定是 final
      // 值（没有 setTimeout / debounce 延后 POST 的代码路径）。
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      expect(extraCalls).toBe(0);
    });

  test('invalid `?code=BOGUS` → URL 仍被清干净；停在 public tier',
    async ({ page }) => {
      // 先清掉上一 test 留的 LS（context 不共享但 page 串跑共享 storage 路径，
      // 保险起见用 evaluate 清）。
      await goto(page, '/');
      await page.evaluate(() => window.localStorage.clear());

      await goto(page, '/?code=BOGUS-NOPE');
      // 等 sessions POST 返非 200（坏码）
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.request().method() === 'POST');

      // URL 上 code= 也被清掉（regardless of API outcome）
      await expect.poll(() => page.url(), { timeout: 5_000 })
        .not.toMatch(/[?&]code=/);

      // SessionStrip 应不渲染（public tier, 没 code 没 byoai）
      await expect(page.getByTestId('session-strip')).toHaveCount(0);
    });
});

async function initOwnerWithCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedCode(request);
  await request.dispose();
}

async function seedCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // 启 MCP session 是为了把 owner-side 的状态都跑通；createCode 自己不需要
  const apiToken = await createAPIToken(request, csrf, 'qr-seed-token');
  await initMCP(request, apiToken);
  await createCode(request, csrf, {
    code: VISITOR_CODE,
    label: 'QR scan code',
  });
}
