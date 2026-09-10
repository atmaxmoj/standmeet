// microsite-per-page-seo.spec.ts —— #7A: SEO follows each microsite. The owner sets a per-page
// seo_title + seo_description + seo_image from the editor's SEO panel, and the served /p/<slug>
// page injects them into its <head> — <title>, <meta name="description">, and OG/Twitter tags.
//
// Injected first (right after <head>), so they win over the built page's own default <title>.
//
// This test drives the REAL SeoPanel (fill the fields, click Save) rather than PUT /seo directly:
// an owner control that renders but doesn't work (the LocaleSwitch lesson) must fail an e2e, so the
// panel is exercised through the browser, not bypassed via the API.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pageseo@example.com', password: 'correct-horse-battery-staple',
  handle: 'pageseo', fullName: 'Page SEO Owner',
};
const SLUG = 'press';
const SEO_TITLE = 'Press Kit — Everything You Need';
const SEO_DESC = 'Logos, bio, and contact for the press.';
const SEO_IMAGE = 'https://cdn.example.com/press-card.png';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 420_000 });
test.describe('per-microsite SEO is set from the editor panel and injected into the served head', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('filling the editor SEO panel injects title + description + Open Graph / Twitter tags',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await publishPage(request, csrf, SLUG,
        'export default function App(){return <main>press</main>;}', 300_000);

      // Drive the REAL SeoPanel in the editor: open it, fill the three fields, click Save. No API
      // shortcut — if the panel or its Save button is not wired, this fails (the LocaleSwitch lesson).
      await openReader(adminPage, `/admin/edit/${SLUG}`);
      const panel = adminPage.getByTestId('microsite-seo');
      await expect(panel, 'the editor shows the SEO panel for an existing page').toBeVisible({ timeout: 15_000 });
      await panel.locator('summary').click();
      await adminPage.getByTestId('microsite-seo-title').fill(SEO_TITLE);
      await adminPage.getByTestId('microsite-seo-desc').fill(SEO_DESC);
      await adminPage.getByTestId('microsite-seo-image').fill(SEO_IMAGE);
      await adminPage.getByTestId('microsite-seo-save').click();

      // The served page's head reflects what the panel saved (poll: the click's save is async).
      await expect.poll(async () => {
        const html = await (await request.get(`${BACKEND}/api/v1/microsites/${SLUG}`)).text();
        return html.includes(`<title>${SEO_TITLE}</title>`);
      }, { message: 'the panel Save reached the served head', timeout: 15_000 }).toBe(true);

      const html = await (await request.get(`${BACKEND}/api/v1/microsites/${SLUG}`)).text();
      expect(html, 'meta description').toContain(`<meta name="description" content="${SEO_DESC}">`);
      expect(html, 'og:title').toContain(`<meta property="og:title" content="${SEO_TITLE}">`);
      expect(html, 'og:description').toContain(`<meta property="og:description" content="${SEO_DESC}">`);
      expect(html, 'og:image').toContain(`<meta property="og:image" content="${SEO_IMAGE}">`);
      expect(html, 'twitter card is the large-image variant when an image is set')
        .toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html, 'twitter:image').toContain(`<meta name="twitter:image" content="${SEO_IMAGE}">`);
      await request.dispose();
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
