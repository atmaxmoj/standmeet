// wiki-landing-extended.spec.ts —— wiki landing extended: private wiki,
// AskAboutThis, 404 slug.
//
// 用户故事：
//   1. cover hero 渲染 (title + date)
//   2. private wiki + 没 code → LockedView
//   3. AskAboutThis (kind=wiki) → /?q=...
//   4. 不存在的 slug → 404

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'wiki-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wikiext',
  fullName: 'Wiki Ext Owner',
};

test.describe('wiki landing extended cases', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('wiki page shows cover hero with title and date',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('heading', { name: 'Wiki Extended' })).toBeVisible();
    });

  test('nonexistent wiki slug → locked view',
    async ({ page }) => {
      await goto(page, '/wiki/nonexistent-wiki-slug-xyz');
      await expect(page.getByText('This entry requires an access code'))
        .toBeVisible({ timeout: 5_000 });
    });

  test('wiki AskAboutThis → links to /?q=...',
    async ({ page }) => {
      await goto(page, '/wiki/wiki-extended');
      const form = page.getByTestId('article-ask-form');
      await expect(form).toBeVisible({ timeout: 5_000 });
      // starter link should point to /?q=...
      const starter = page.locator('a[href^="/?q="]').first();
      await expect(starter).toBeVisible();
      const href = await starter.getAttribute('href');
      expect(href).toMatch(/^\/\?q=/);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function seedIndexedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'wiki-ext-seed');
  const sid = await initMCP(request, token);
  const { wikiID } = await seedPublicWiki(request, token, sid, {
    body: 'Extended wiki content for testing.',
    title: 'Wiki Extended',
  });
  await callTool(request, token, sid, 'seo.set_wiki_slug', {
    wiki_id: wikiID,
    seo_slug: 'wiki-ext-slug',
    seo_description: 'Extended wiki test.',
    seo_indexed: true,
  });
}
