// microsite-per-page-seo.spec.ts —— #7A: SEO follows each microsite. The owner sets a per-page
// seo_title + seo_description (microsite.set_seo / PUT /microsites/{slug}/seo), and the served
// /p/<slug> page injects them into its <head> — a <title> and a <meta name="description">.
//
// Injected first (right after <head>), so they win over the built page's own default <title>.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pageseo@example.com', password: 'correct-horse-battery-staple',
  handle: 'pageseo', fullName: 'Page SEO Owner',
};
const SLUG = 'press';
const SEO_TITLE = 'Press Kit — Everything You Need';
const SEO_DESC = 'Logos, bio, and contact for the press.';

test.describe.configure({ timeout: 420_000 });
test.describe('per-microsite SEO is injected into the served head', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('set_seo puts a <title> + <meta description> into the /p/<slug> head', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await buildLiveMicrosite(request, csrf);

    // Set the per-page SEO.
    const seo = await request.put(`${BACKEND}/api/admin/microsites/${SLUG}/seo`, {
      headers: { 'X-Csrftoken': csrf }, data: { seo_title: SEO_TITLE, seo_description: SEO_DESC },
    });
    expect(seo.status(), 'set_seo ok').toBe(200);

    // The served page's head carries them.
    const page = await request.get(`${BACKEND}/api/v1/microsites/${SLUG}`);
    const html = await page.text();
    expect(html, 'the injected <title> is present').toContain(`<title>${SEO_TITLE}</title>`);
    expect(html, 'the injected meta description is present')
      .toContain(`<meta name="description" content="${SEO_DESC}">`);
    await request.dispose();
  });
});

async function buildLiveMicrosite(request: APIRequestContext, csrf: string): Promise<void> {
  const h = { 'X-Csrftoken': csrf };
  expect((await request.post(`${BACKEND}/api/admin/microsites/`, {
    headers: h, data: { slug: SLUG, title: 'Press' },
  })).status(), 'create').toBe(201);
  await request.put(`${BACKEND}/api/admin/microsites/${SLUG}/files`, {
    headers: h, data: { path: 'App.tsx', content: 'export default function App(){return <main>press</main>;}' },
  });
  const buildID = (await (await request.post(`${BACKEND}/api/admin/microsites/${SLUG}/build`, { headers: h })).json() as { build_id: string }).build_id;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = await (await request.get(`${BACKEND}/api/admin/microsites/builds/${buildID}`, { headers: h })).json();
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  expect((await request.post(`${BACKEND}/api/admin/microsites/${SLUG}/live`, {
    headers: h, data: { build_id: buildID },
  })).status(), 'promote to live').toBe(200);
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
