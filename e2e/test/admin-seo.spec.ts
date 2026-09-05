// admin-seo.spec.ts —— admin SEO section wired to the real backend (#102).
//
// The section is NOT a mockup: site_title is owner-editable and persists;
// og:description + canonical host are READ-ONLY mirrors of existing values
// (page tagline / public_url) with links to where they're edited; robots is a
// real toggle; indexing stats are real counts with an owner-selectable scope
// (default = all tiers). The "regenerate sitemap" button and "twitter handle"
// field are gone (the sitemap is computed live; twitter was a dead field).
//
// Per-entry SEO now speaks the consolidated vocabulary: `excerpt` (was
// seo_description) + `published` (was seo_indexed).
//
// User stories:
//   1. defaults load real values; edit site_title → save → persists + success toast
//   2. save failure → error toast (never silently swallowed)
//   3. og:description / canonical are read-only mirrors (+ edit links), not inputs
//   4. no "regenerate sitemap" button, no "twitter handle" field
//   5. indexing stats show real counts; scope selector re-counts; default = all
//   6. PATCH wiki { excerpt, published } → 200

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { expectErrorToast, expectSuccessToast } from '@/fixtures/toast';

const OWNER = {
  email: 'seo@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'seo',
  fullName: 'SEO Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin SEO section (real backend)', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('site_title loads real value, edit + save persists with success toast',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      await adminPage.waitForURL('**/admin/seo', { timeout: 5_000 });

      const title = adminPage.getByTestId('seo-site-title');
      await expect(title).toBeVisible();
      await title.fill('Sijie · corpus');
      await adminPage.getByTestId('seo-save').click();
      await expectSuccessToast(adminPage, /saved/i);

      // reload → the persisted value comes back from the backend, not a mock.
      await adminPage.reload();
      await expect(adminPage.getByTestId('seo-site-title')).toHaveValue('Sijie · corpus');
    });

  test('save failure surfaces an error toast (not swallowed)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      await adminPage.route('**/api/admin/seo', (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({ status: 500, body: '{"error":{"code":"boom","message":"nope"}}' })
          : route.continue());
      await adminPage.getByTestId('seo-site-title').fill('whatever');
      await adminPage.getByTestId('seo-save').click();
      await expectErrorToast(adminPage, /\S/);
    });

  test('the canonical host is a read-only mirror with an edit link to the real editor',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      // The og:description mirror is gone: the homepage is a microsite now, so og:description
      // no longer mirrors a built-in "hero prose" field the owner edits here. What remains is the
      // canonical host, read-only, linking to where the public URL is actually edited — the
      // /admin/account site block (the public-URL editor moved there with the homepage rework).
      await expect(adminPage.getByTestId('seo-description')).toHaveCount(0);
      await expect(adminPage.getByTestId('seo-canonical')).toBeVisible();
      await expect(adminPage.getByTestId('seo-canonical-edit'))
        .toHaveAttribute('href', /\/admin\/account/);
    });

  test('no regenerate-sitemap button, no twitter field',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      await expect(adminPage.getByTestId('seo-regenerate')).toHaveCount(0);
      await expect(adminPage.getByText(/twitter/i)).toHaveCount(0);
    });

  test('indexing stats are real; default scope = all tiers',
    async ({ adminPage, request }) => {
      // seed one published wiki so a count is non-zero.
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'seo-stats');
      const sid = await initMCP(request, token);
      const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create',
        { genre: 'raw', body: 'x', source: 'mcp:e2e', tags: [] });
      const wiki = await callTool<{ id: string }>(request, token, sid, 'corpus.promote',
        { genre: 'raw', id: raw.id, title: 'Stats Wiki' });
      await patchWikiSEO(request, csrf, wiki.id, { excerpt: 'e', published: true });

      await gotoAdminSection(adminPage, 'seo');
      const stats = adminPage.getByTestId('seo-indexing');
      await expect(stats).toBeVisible();
      // default scope = all tiers → wiki count reflects the published entry.
      await expect(adminPage.getByTestId('seo-stat-wiki')).toHaveText(/[1-9]/);
    });

  // The panel saved site_title, then the owner changes only robots from Claude Code — the title
  // must still be there.
  //
  // This guards a real bug: that upsert overwrites the whole row, and the MCP call's arguments
  // don't include site_title, so every time robots gets toggled from an AI client, the site title
  // the owner wrote gets wiped to empty. The fix isn't adding a field on the MCP side — it's
  // making the arguments distinguish "not mentioned" from "set to empty" (one rule, both surfaces).
  test('MCP update_settings without site_title keeps the title the panel saved',
    mcpKeepsSiteTitle);

  // per-entry SEO now speaks {excerpt, published}. Old field names are gone.
  test('PATCH wiki { excerpt, published } → 200', patchesOneEntry);
});

async function mcpKeepsSiteTitle({ request }: { request: APIRequestContext }): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const put = await request.put('/api/admin/seo', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      site_title: 'Kept Through MCP', og_template: '%s · kept',
      sitemap_extras: [], index_robots: true,
    },
  });
  expect(put.status()).toBe(200);

  const token = await createAPIToken(request, csrf, 'seo-merge');
  const sid = await initMCP(request, token);
  await callTool<unknown>(request, token, sid, 'seo.update_settings',
    { index_robots: false });

  const after = await callTool<{ site_title: string; index_robots: boolean }>(
    request, token, sid, 'seo.get_settings', {});
  expect(after.index_robots, 'the field it did mention changed').toBe(false);
  expect(after.site_title, 'the field it never mentioned survived')
    .toBe('Kept Through MCP');
}

async function patchesOneEntry({ request }: { request: APIRequestContext }): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'seo-patch');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create',
    { genre: 'raw', body: 'x', source: 'mcp:e2e', tags: [] });
  const wiki = await callTool<{ id: string }>(request, token, sid, 'corpus.promote',
    { genre: 'raw', id: raw.id, title: 'SEO Patch Test' });
  const res = await patchWikiSEO(request, csrf, wiki.id, {
    excerpt: 'a short excerpt', published: true,
  });
  expect(res.status()).toBe(200);
}

async function patchWikiSEO(
  request: APIRequestContext, csrf: string, wikiID: string,
  body: { excerpt: string; published: boolean },
) {
  return request.patch(`/api/admin/corpus/wiki/${wikiID}/seo`, {
    headers: { 'X-Csrftoken': csrf },
    data: body,
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
