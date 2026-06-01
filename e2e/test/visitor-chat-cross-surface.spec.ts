// visitor-chat-cross-surface.spec.ts —— G-5: 持 code visitor 在 wiki /
// output landing 上能看到 chat 全套 (SessionStrip gauge + FloatingChatDock
// pill)，开 dock 问一句话 quota gauge +1。
//
// 现有 session-strip.spec.ts 验了 / + /writings 的 strip mount；这里补
// /wiki/<path> + /output/<path> 两个 SEO landing，再加 ask → quota +1 的
// UI flow 验证。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const WIKI_PATH = 'projects/lucerna';
const QUOTA_MAX = 10;

test.describe('visitor chat 铺全 surface + quota 可见', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cross-surface-seed');
    const sid = await initMCP(request, token);
    const { wikiID } = await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool I built.',
      title: 'Lucerna', path: WIKI_PATH,
    });
    await callTool<unknown>(request, token, sid, 'seo.set_wiki_slug', {
      wiki_id: wikiID, seo_slug: WIKI_PATH,
      seo_description: 'Local-first knowledge tool.', seo_indexed: true,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'cross-surface spec',
      max_turns_per_session: QUOTA_MAX,
    });
    await request.dispose();
  });

  test('coded visitor 在 /wiki landing 看到 SessionStrip + FloatingChatDock pill',
    async ({ page }) => {
      // 绝对入口 absorb code，再 UI-跳到 wiki landing
      await page.goto(`/?code=${CODE}`);
      await page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/sessions') && r.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // 跳到 wiki landing (entry-style 直 goto，跨 surface)
      await page.goto(`/wiki/${WIKI_PATH}`);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('wiki-body')).toBeVisible();
      // gauge 0/MAX
      const gauge = page.getByTestId('session-strip-gauge');
      await expect(gauge).toContainText('0');
      await expect(gauge).toContainText(String(QUOTA_MAX));
      // floating chat dock pill (visitor 有 code session → pill 出现)
      await expect(page.getByTestId('floating-dock-pill')).toBeVisible();
    });

  test('开 floating dock 问一句 → quota gauge +1',
    async ({ page }) => {
      await page.goto(`/?code=${CODE}`);
      await page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/sessions') && r.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // 跳到 wiki landing
      await page.goto(`/wiki/${WIKI_PATH}`);
      const gauge = page.getByTestId('session-strip-gauge');
      await expect(gauge).toContainText(`0 / ${QUOTA_MAX}`);

      // 开 dock → 输 q → enter
      await page.getByTestId('floating-dock-pill').click();
      const dockInput = page.getByTestId('floating-chat-input');
      await expect(dockInput).toBeVisible({ timeout: 3_000 });
      await dockInput.fill('hi');
      await dockInput.press('Enter');

      // 等 mock 回复 (没 tool 调用，直接 final text)；quota +1
      await expect(gauge).toContainText(`1 / ${QUOTA_MAX}`, { timeout: 20_000 });
    });
});
