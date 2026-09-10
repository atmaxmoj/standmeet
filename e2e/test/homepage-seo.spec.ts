// homepage-seo.spec.ts —— the homepage's SEO is set the SAME way as any microsite (the editor's
// SEO panel), and it applies to the SITE ROOT `/`. The homepage IS the reserved `home` microsite,
// so setting its seo_title / seo_description / seo_image injects <title> + <meta description> + the
// OG/Twitter tags into what `/api/v1/homepage` serves at the root.
//
// Why this spec exists (the gap it closes): "SEO follows the microsite" was only ever tested on
// `/p/<slug>` (microsite-per-page-seo.spec, slug='press'). The homepage serves through a DIFFERENT
// endpoint (`/api/v1/homepage`, serveHomepage → serveSlugAt) and had NO SEO test at all — so by the
// "find the test" rule, the site root's SEO was unverified (== not there). Two green decisions left
// the hole: Q1 (185c4321b) stopped materializing `home` at claim, and drop-seo-settings removed the
// global SEO on the premise that "site-wide default SEO = the homepage microsite's own per-page
// SEO" — a premise that only holds once the homepage is that microsite. This locks it down.
//
// Drives the REAL SeoPanel in the home editor (fill fields, click Save), not PUT /seo — an owner
// control that renders but isn't wired must fail an e2e (the LocaleSwitch lesson).

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { seedDefaultHomepage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'homeseo@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeseo', fullName: 'Home SEO Owner',
};
// No '&' / '<' in the title: the served head HTML-escapes them (correctly), and this spec's subject
// is "home SEO reaches the site root", not the escaping (that is seoHead's own concern).
const SEO_TITLE = 'Sijie Wang — Portfolio and Thoughts';
const SEO_DESC = 'What I keep thinking about, answered in my own voice.';
const SEO_IMAGE = 'https://cdn.example.com/home-card.png';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 420_000 });
test.describe('homepage SEO comes from the same editor panel and lands on the site root', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the home editor SEO panel injects title + description + Open Graph into /api/v1/homepage',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      // The owner edited the homepage → the reserved `home` microsite exists and is live.
      await seedDefaultHomepage(request, csrf);

      // Drive the REAL SeoPanel in the HOME editor — the same panel any page has.
      await openReader(adminPage, `/admin/edit/home`);
      const panel = adminPage.getByTestId('microsite-seo');
      await expect(panel, 'the home editor shows the same SEO panel').toBeVisible({ timeout: 15_000 });
      await panel.locator('summary').click();
      await adminPage.getByTestId('microsite-seo-title').fill(SEO_TITLE);
      await adminPage.getByTestId('microsite-seo-desc').fill(SEO_DESC);
      await adminPage.getByTestId('microsite-seo-image').fill(SEO_IMAGE);
      await adminPage.getByTestId('microsite-seo-save').click();

      // The SITE ROOT serve (/api/v1/homepage) reflects what the panel saved (Save is async → poll).
      await expect.poll(async () => {
        const html = await (await request.get(`${BACKEND}/api/v1/homepage`)).text();
        return html.includes(`<title>${SEO_TITLE}</title>`);
      }, { message: 'the panel Save reached the homepage head', timeout: 15_000 }).toBe(true);

      const html = await (await request.get(`${BACKEND}/api/v1/homepage`)).text();
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
