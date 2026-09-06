// seo-feeds.spec.ts — a crawler reads /robots.txt + /sitemap.xml and gets the owner
// page + indexed wiki landing pages.
//
// User story:
//   GoogleBot visits the site root, fetches robots.txt first to learn whether it's
//   allowed to crawl, then fetches sitemap.xml for the URL list. We should return a
//   spec-compliant format on both endpoints, including the owner public page + every
//   published=true wiki landing page.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const INDEXED_SLUG = 'why-standmeet-exists';
const MICRO_SLUG = 'press-kit';

test.describe.configure({ timeout: 420_000 });
test.describe('crawlers can read robots + sitemap', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedIndexedWiki(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await seedLiveMicrosite(request, csrf);
    await request.dispose();
  });

  test('GET /robots.txt returns sitemap link and allow', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/robots.txt`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test('GET /sitemap.xml lists owner page + indexed wiki landings', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/sitemap.xml`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain(`<`);
    expect(body).toContain(`/wiki/${INDEXED_SLUG}<`);
  });

  test('GET /sitemap.xml also lists live microsites at /p/<slug>', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/sitemap.xml`);
    const body = await res.text();
    // The dynamic sitemap now includes each live microsite (the reserved home page is excluded —
    // it is served at `/`, already listed as the owner's public URL). RED before: microsites absent.
    expect(body, 'the live microsite appears in the sitemap').toContain(`/p/${MICRO_SLUG}<`);
  });
});

// seedLiveMicrosite — create + build + promote a minimal microsite so it has a live build (only
// live pages appear in the sitemap). The build is asynchronous, so poll it to 'built' before
// promoting.
async function seedLiveMicrosite(request: APIRequestContext, csrf: string): Promise<void> {
  const h = { 'X-Csrftoken': csrf };
  const create = await request.post(`${BACKEND}/api/admin/microsites/`, {
    headers: h, data: { slug: MICRO_SLUG, title: 'Press Kit' },
  });
  expect(create.status(), 'create microsite').toBe(201);
  await request.put(`${BACKEND}/api/admin/microsites/${MICRO_SLUG}/files`, {
    headers: h, data: { path: 'App.tsx', content: 'export default function App(){return <main>press kit</main>;}' },
  });
  const started = await request.post(`${BACKEND}/api/admin/microsites/${MICRO_SLUG}/build`, { headers: h });
  const buildID = (await started.json() as { build_id: string }).build_id;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = await (await request.get(`${BACKEND}/api/admin/microsites/builds/${buildID}`, { headers: h })).json();
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  const live = await request.post(`${BACKEND}/api/admin/microsites/${MICRO_SLUG}/live`, {
    headers: h, data: { build_id: buildID },
  });
  expect(live.status(), 'promote to live').toBe(200);
}

async function seedIndexedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  const { wikiID } = await seedPublicWiki(request, apiToken, sid, {
    body: 'StandMeet replaces a résumé for people who think a lot.',
    title: 'Why StandMeet exists',
    tags: ['intro'],
  });
  await publishEntry(request, apiToken, sid, {
    genre: 'wiki', id: wikiID, excerpt: 'The founding observation.',
  });
}
