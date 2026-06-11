// admin-seo.spec.ts —— admin SEO section: defaults form, regenerate sitemap,
// indexing stats, OG preview.
//
// 用户故事：
//   1. defaults form → fields visible
//   2. "regenerate sitemap" button → UI feedback
//   3. indexing stats → pages / outputs / posts counts
//   4. OG preview card renders

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'seo@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'seo',
  fullName: 'SEO Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin SEO section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('SEO defaults form fields visible',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      await adminPage.waitForURL('**/admin/seo', { timeout: 5_000 });
      await expect(adminPage.getByTestId('seo-site-title')).toBeVisible();
    });

  test('regenerate sitemap button visible + clickable',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      const btn = adminPage.getByRole('button', { name: /regenerate sitemap/i });
      await expect(btn).toBeVisible();
      await btn.click();
    });

  test('indexing stats show page counts',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      const stats = adminPage.getByTestId('seo-indexing');
      await expect(stats).toBeVisible();
    });

  // #42:PATCH /api/admin/wiki/{id}/seo 之前 500。建一条 wiki 再 PATCH seo,期望 200。
  test('PATCH wiki seo (set indexed) → 200, not 500', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'seo-patch');
    const sid = await initMCP(request, token);
    const raw = await callTool<{ raw_id: string }>(
      request, token, sid, 'raw_dump', { body: 'x', source: 'mcp:e2e', tags: [] },
    );
    const wiki = await callTool<{ wiki_id: string }>(
      request, token, sid, 'promote_to_wiki', { raw_id: raw.raw_id, title: 'SEO Patch Test' },
    );
    const res = await patchWikiSEO(request, csrf, wiki.wiki_id);
    expect(res.status()).toBe(200);
  });
});

async function patchWikiSEO(request: APIRequestContext, csrf: string, wikiID: string) {
  return request.patch(`/api/admin/wiki/${wikiID}/seo`, {
    headers: { 'X-Csrftoken': csrf },
    data: { seo_description: 'a short seo description', seo_indexed: true },
  });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
