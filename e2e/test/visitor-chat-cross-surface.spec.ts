// visitor-chat-cross-surface.spec.ts —— G-5: 持 code visitor 在所有
// document-bearing surface (wiki / output landing + writings slug) 上都
// 能看到 chat 全套 (SessionStrip gauge + FloatingChatDock pill)，开 dock
// 问一句话 quota gauge +1。
//
// 现有 session-strip.spec.ts 只验过 / 和 /writings 索引上的 strip mount；
// 这里补 /wiki/<path> + /output/<path> + /writings/<slug> 三个 SEO landing，
// 再加 ask → quota +1 的 UI flow 验证。

import { test, expect, type Page } from '@/fixtures/test';

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
const OUTPUT_PATH = 'projects/lucerna-published';
const WRITING_SLUG = 'lucerna-notes';
const QUOTA_MAX = 10;

interface SurfaceCase { path: string; bodyTestid: string; label: string }

const SURFACES: readonly SurfaceCase[] = [
  { path: `/wiki/${WIKI_PATH}`,        bodyTestid: 'wiki-body',           label: 'wiki landing' },
  { path: `/output/${OUTPUT_PATH}`,    bodyTestid: 'output-body',         label: 'output landing' },
  { path: `/writings/${WRITING_SLUG}`, bodyTestid: 'writing-article-body', label: 'writing slug' },
];

test.describe('visitor chat 铺全 document surface + quota 可见', () => {
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

    // wiki + seo_indexed
    const { wikiID } = await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool I built.',
      title: 'Lucerna', path: WIKI_PATH,
    });
    await callTool<unknown>(request, token, sid, 'seo.set_wiki_slug', {
      wiki_id: wikiID, seo_slug: WIKI_PATH,
      seo_description: 'Local-first knowledge tool.', seo_indexed: true,
    });

    // output (promote wiki → output) + seo_indexed
    const out = await callTool<{ output_id: string }>(
      request, token, sid, 'promote_wiki_to_output',
      { wiki_id: wikiID, title: 'Lucerna · Published', path: OUTPUT_PATH },
    );
    await callTool<unknown>(request, token, sid, 'seo.set_output_slug', {
      output_id: out.output_id, seo_slug: OUTPUT_PATH,
      seo_description: 'Lucerna polished.', seo_indexed: true,
    });

    // writing (publish=true)
    await callTool<unknown>(request, token, sid, 'writing_create', {
      slug: WRITING_SLUG, title: 'Lucerna notes',
      excerpt: 'rough notes on lucerna.',
      body_md: 'Some notes on the local-first tool.',
      cover_headline: 'lucerna notes.', cover_sub: 'seeded.',
      cover_hue: 'acid', tags: ['notes'], publish: true,
    });

    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'cross-surface spec',
      max_turns_per_session: QUOTA_MAX,
    });
    await request.dispose();
  });

  for (const s of SURFACES) {
    test(`coded visitor 在 ${s.label} 看到 SessionStrip gauge + FloatingChatDock pill`,
      async ({ page }) => {
        await absorbCode(page);
        await page.goto(s.path);
        await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId(s.bodyTestid)).toBeVisible();
        const gauge = page.getByTestId('session-strip-gauge');
        await expect(gauge).toContainText('0');
        await expect(gauge).toContainText(String(QUOTA_MAX));
        await expect(page.getByTestId('floating-dock-pill')).toBeVisible();
      });
  }

  test('开 floating dock 问一句 → quota gauge +1 (wiki landing)',
    async ({ page }) => {
      await absorbCode(page);
      await page.goto(`/wiki/${WIKI_PATH}`);
      const gauge = page.getByTestId('session-strip-gauge');
      await expect(gauge).toContainText(`0 / ${QUOTA_MAX}`);

      await page.getByTestId('floating-dock-pill').click();
      const dockInput = page.getByTestId('floating-chat-input');
      await expect(dockInput).toBeVisible({ timeout: 3_000 });
      await dockInput.fill('hi');
      await dockInput.press('Enter');

      await expect(gauge).toContainText(`1 / ${QUOTA_MAX}`, { timeout: 20_000 });
    });
});

async function absorbCode(page: Page): Promise<void> {
  await page.goto(`/?code=${CODE}`);
  await page.waitForResponse((r) =>
    r.url().endsWith('/api/v1/sessions') && r.status() === 200);
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
}
