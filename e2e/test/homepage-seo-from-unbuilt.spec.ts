// homepage-seo-from-unbuilt.spec.ts — BLACK BOX, the owner's real journey. On a fresh instance the
// homepage is NOT materialized (Q1/185c4321b: `/` renders DefaultHome from code). An owner must be
// able to set the site root's SEO from the admin — starting from that default state, by clicking,
// without anything seeding a built `home` microsite first.
//
// Why the existing homepage-seo spec passes while the panel is absent on prod: it calls
// seedDefaultHomepage() — four API calls that create+build+promote `home` — BEFORE it looks for the
// SEO panel. That manufactures the one precondition (a built `home` row) that makes SeoPanel render
// (SeoPanel returns null when the row is absent). The real owner never crosses that gap, and this
// spec refuses to cross it for them: it seeds NOTHING and drives the GUI from the default state.
//
// RED today: from the unbuilt homepage editor the SEO title field never appears (SeoPanel is null),
// so the owner has no way to set the site root's title/description/OG.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'home-seo-unbuilt@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeseounbuilt', fullName: 'Home SEO Unbuilt Owner',
};
const SEO_TITLE = 'Sijie Wang — Portfolio and Thoughts';
const SEO_DESC = 'What I keep thinking about, answered in my own voice.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('homepage SEO is reachable from the default (unbuilt) homepage, no seeding', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('an owner sets the site-root SEO from the homepage editor and it lands on /',
    async ({ adminPage: page }) => {
      test.setTimeout(120_000);

      // The owner opens the homepage editor the way the admin offers it — a click, from the default
      // state. No seedDefaultHomepage: `home` is not built here, exactly like a real fresh instance.
      await goto(page, '/admin/edit/home');

      // The SEO control must be here for the owner to use. The panel is a collapsed <details>, so
      // expand it first (its absence — not its collapse — is the real "no SEO" case).
      const panel = page.getByTestId('microsite-seo');
      await expect(panel, 'the homepage editor has a SEO panel at all').toBeVisible({ timeout: 20_000 });
      await panel.locator('summary').click();
      const title = page.getByTestId('microsite-seo-title');
      await expect(title, 'the homepage SEO title field is usable').toBeVisible({ timeout: 10_000 });
      await title.fill(SEO_TITLE);
      await page.getByTestId('microsite-seo-desc').fill(SEO_DESC);
      await page.getByTestId('microsite-seo-save').click();

      // What a visitor / crawler gets at the site root reflects it.
      await expect.poll(async () => {
        const html = await (await page.request.get('/')).text();
        return html.includes(`<title>${SEO_TITLE}</title>`);
      }, { message: 'the site root <head> carries the SEO the owner just set', timeout: 20_000 })
        .toBe(true);
    });
});
