// output-landing.spec.ts —— /output/<slug> SEO landing end to end.
//
// User story:
//   owner distills a wiki into an output → sets seo_slug + published on the output → in
//   admin /admin/output the card's "view live ↗" → the visitor sees the full markdown body at
//   /output/<slug>, and sitemap.xml lists this URL.
//
// Currently seo_slug is written only via MCP / DB; SEO editing in the admin UI comes later. Here we
// go the same route as SetWikiSEO directly: a postgres UPDATE straight into output_entries.

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const OUTPUT_TITLE = 'Local-first essay';
const OUTPUT_BODY = 'POLISHED_OUTPUT_BODY_MARKER';
const SLUG = 'local-first-essay';

const DB_CONTAINER = 'standmeet-dev-db-1';

test.describe('public /output/<slug> SEO landing', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const id = await seedOutputViaMCP(request);
    setOutputSeo(id, 'Polished local-first essay description');
    await request.dispose();
  });

  test('visitor opens /output/<slug> → sees full body + sitemap lists URL',
    async ({ page }) => {
      await goto(page, `/output/${SLUG}`);
      await expect(page.getByTestId('output-landing')).toBeVisible();
      await expectBodyAndTitle(page);
      // #39: the document page goes back to the writing index, no longer "← home" to /.
      await expect(page.getByRole('link', { name: '← writing' }))
        .toHaveAttribute('href', '/writings');
      const sitemap = await fetchSitemap(page);
      expect(sitemap).toContain(`/output/${SLUG}`);
    });
});

async function seedOutputViaMCP(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'corpus-seeder');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create', {
    genre: 'raw', body: 'rough draft on local-first software', source: 'mcp:spec', tags: [],
  });
  const wiki = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw', id: raw.id, title: 'Local-first sketch', tags: [],
  });
  const out = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote',
    {
      genre: 'wiki', id: wiki.id, title: OUTPUT_TITLE, tags: [],
      // On promote the body reuses the source wiki body; we then write SQL to overwrite it with a distinct marker.
    },
  );
  // overwrite body via DB to embed the marker string we'll assert in browser.
  setOutputBody(out.id, OUTPUT_BODY);
  return out.id;
}

function setOutputBody(outputID: string, body: string): void {
  const sql =
    `UPDATE corpus_notes SET body = '${body}' WHERE id = '${outputID}' AND genre = 'output'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`, {
    stdio: 'pipe',
  });
}

// Address-tree derivation (title slug): public URL = /output/local-first-essay, no path column
// written, just set published + description to get it into the public landing/sitemap.
function setOutputSeo(outputID: string, description: string): void {
  const sql =
    `UPDATE corpus_notes SET excerpt = '${description}',`
    + ` published = true WHERE id = '${outputID}' AND genre = 'output'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`, {
    stdio: 'pipe',
  });
}

async function expectBodyAndTitle(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: OUTPUT_TITLE })).toBeVisible();
  await expect(page.getByText(OUTPUT_BODY, { exact: false })).toBeVisible();
}

async function fetchSitemap(page: Page): Promise<string> {
  const resp = await page.request.get('http://localhost:8000/sitemap.xml');
  expect(resp.ok()).toBeTruthy();
  return resp.text();
}
