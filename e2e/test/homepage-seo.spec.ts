// homepage-seo.spec.ts —— the homepage's SEO is set the SAME way as any microsite: the owner opens
// the microsites section, opens the homepage editor, opens its SEO panel, fills it, saves — and it
// lands on the SITE ROOT `/` (served by /api/v1/homepage). The homepage IS the reserved `home`
// microsite, so its seo_title / seo_description / seo_image become <title> + <meta description> +
// the OG/Twitter tags at the root.
//
// This drives ONLY the UI — click the microsites nav, click the homepage's edit entry, open the SEO
// panel, type, click Save. NOTHING is seeded through the API or MCP: the owner's real complaint was
// that the homepage editor had no SEO section at all (the panel only rendered once a `home` row was
// materialized, which a normal owner never does by hand). A test that seeds that row first proves
// the panel works in a state the owner can't reach — so it seeds nothing and walks the owner's path.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

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
test.describe('homepage SEO is edited in the homepage editor, like any microsite, and reaches the root', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('microsites → homepage → SEO panel: fill + Save injects title/description/OG into the root',
    async ({ playwright, adminPage }) => {
      // Owner's own path: microsites section → the homepage card's "edit" → the mini-IDE at /home.
      await gotoAdminSection(adminPage, 'microsites');
      await adminPage.getByTestId('microsite-edit-homepage').click();
      await expect(adminPage.getByTestId('microsite-editor'), 'the homepage editor opened')
        .toBeVisible({ timeout: 30_000 });

      // The homepage editor must carry the SAME SEO panel every other microsite editor has.
      const panel = adminPage.getByTestId('microsite-seo');
      await expect(panel, 'the homepage editor shows a SEO panel, like any microsite')
        .toBeVisible({ timeout: 15_000 });
      await panel.locator('summary').click();
      await adminPage.getByTestId('microsite-seo-title').fill(SEO_TITLE);
      await adminPage.getByTestId('microsite-seo-desc').fill(SEO_DESC);
      await adminPage.getByTestId('microsite-seo-image').fill(SEO_IMAGE);
      await adminPage.getByTestId('microsite-seo-save').click();

      // The SITE ROOT serve (/api/v1/homepage) reflects what the panel saved (Save is async → poll).
      const request = await playwright.request.newContext();
      await expect.poll(async () => {
        const html = await (await request.get(`${BACKEND}/api/v1/homepage`)).text();
        return html.includes(`<title>${SEO_TITLE}</title>`);
      }, { message: 'the panel Save reached the homepage head', timeout: 20_000 }).toBe(true);

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
