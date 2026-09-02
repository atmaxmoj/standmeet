// nav-page-vs-pages.spec.ts -- the admin sidebar's two "page(s)" entries must be
// **distinguishable**, not two signs for the same word.
//
// rot-D2: slug `page` carries "public page" (settings group) -> PageSection, which is the
// one and only public **landing page**; slug `custom-pages` carries "pages" (access
// group) -> CustomPagesSection, the **collection of microsites** built via MCP and served
// at /p/{slug}. The two signs read as the same word -- the owner can't tell which door is
// which. A label has to say what it opens; "public page" / "pages" say neither.
//
// Criterion (asserts the good outcome, not "no red text"): a disambiguating token must
// land -- the landing-page entry must contain "landing", the microsites entry must
// contain "custom"; neither may stay a bare "page"/"pages". RED today on "public
// page"/"pages", GREEN after the rename.
// nav link text lives on data-testid="admin-nav-<slug>" (see AdminSidebar SidebarItem).

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';

const OWNER = {
  email: 'nav-labels@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'navlabels',
  fullName: 'Nav Labels Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sidebar · the landing-page and custom-pages entries are not confusable', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  // The adminPage fixture has already landed on /admin and logged in, with the sidebar
  // (admin-nav-page) visible -- just read the two nav labels directly.
  test('the single-landing-page entry and the microsites entry carry disambiguated labels',
    async ({ adminPage: page }) => {
      const pageNav = page.getByTestId('admin-nav-page');
      const customNav = page.getByTestId('admin-nav-custom-pages');
      await expect(pageNav).toBeVisible();
      await expect(customNav).toBeVisible();

      const pageLabel = (await pageNav.innerText()).trim();
      const customLabel = (await customNav.innerText()).trim();

      // The landing-page entry must carry the disambiguating token "landing" (today it's
      // "public page" -> RED).
      expect(
        /landing/i.test(pageLabel),
        `the single public-page entry must name itself the "landing" page, not a bare "page"; got "${pageLabel}"`,
      ).toBe(true);
      // The microsites entry must carry the disambiguating token "custom" (today it's
      // "pages" -> RED).
      expect(
        /custom/i.test(customLabel),
        `the microsites entry must name itself "custom" pages, not a bare "pages"; got "${customLabel}"`,
      ).toBe(true);

      // Fallback: the two labels, once normalized, must not collide on the same
      // "page"/"pages" word -- two signs that actually mean what they say, not a
      // duplicate of one sign.
      expect(
        normalize(pageLabel) !== normalize(customLabel),
        `the two entries must not collapse to the same word; both read "${pageLabel}" ≈ "${customLabel}"`,
      ).toBe(true);
    });
});

// normalize -- strips case, whitespace, and a trailing plural s, pulling things like
// "public page"/"pages" down to the same baseline, so it can prove two labels aren't just
// two spellings of the same word.
function normalize(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').replace(/s\b/g, '').trim();
}

// ───────────────────────────────────────────────────────────────────────────
// F-N-3: the guard above **stops at the door**. It reads the two signs and calls it done,
// never actually opening either door -- so once the signs got renamed to "landing page" /
// "custom pages", **the two headings behind those doors were still `page` / `pages`**,
// and this guard stayed green the whole time. The owner clicks through: what they
// actually read is the biggest word on the screen after that click.
//
// Criterion: whichever sign gets clicked, the destination's heading must state that
// sign's word -- across the entire nav, not just these two entries (the same mistake has
// already been made in four places today: one lesson only got swept into the field where
// it was first found).
const NAV_ENTRIES: readonly { slug: string; label: string }[] = [
  { slug: 'dashboard', label: 'dashboard' },
  { slug: 'raw', label: 'raw' },
  { slug: 'wiki', label: 'wiki' },
  { slug: 'subjectivity', label: 'subjectivity' },
  { slug: 'writings', label: 'writings' },
  { slug: 'output', label: 'outputs' },
  { slug: 'custom-pages', label: 'custom pages' },
  { slug: 'conversations', label: 'conversations' },
  { slug: 'codes', label: 'codes' },
  { slug: 'roles', label: 'roles' },
  { slug: 'prompts', label: 'prompts' },
  { slug: 'requests', label: 'requests' },
  { slug: 'preview', label: 'preview' },
  { slug: 'sources', label: 'sources' },
  { slug: 'listings', label: 'listings' },
  { slug: 'drafts', label: 'drafts' },
  { slug: 'applications', label: 'applications' },
  { slug: 'skills', label: 'skills' },
  { slug: 'connectors', label: 'connectors' },
  { slug: 'api-mcp', label: 'api · mcp' },
  { slug: 'obsidian', label: 'obsidian' },
  { slug: 'page', label: 'landing page' },
  { slug: 'seo', label: 'seo' },
  { slug: 'ip-bans', label: 'ip bans' },
  { slug: 'account', label: 'account' },
  { slug: 'system', label: 'system' },
];

test.describe('admin · the destination titles itself with the label you clicked', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('every nav entry lands on a section whose heading is that entry’s label',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      const mismatches: string[] = [];
      let previous = '';

      for (const entry of NAV_ENTRIES) {
        const nav = page.getByTestId(`admin-nav-${entry.slug}`);
        await expect(nav, `nav entry ${entry.slug} must exist`).toBeVisible();
        // The screen's own text is the source of truth for the label (the table's copy
        // is transcribed by me, and a transcription error should surface right here).
        expect(
          (await nav.innerText()).trim(),
          `the nav label for ${entry.slug} moved — update this table`,
        ).toBe(entry.label);

        await nav.click();
        const title = page.getByTestId('section-title');
        await expect(title, `a heading must render after clicking "${entry.label}"`)
          .toBeVisible({ timeout: 15_000 });
        // Switching sections is a client-side navigation: wait until the heading is no
        // longer the previous section's text before reading it (otherwise you'd read a
        // stale leftover).
        await expect.poll(
          async () => (await title.innerText()).trim(),
          { message: `heading after clicking "${entry.label}"`, timeout: 15_000 },
        ).not.toBe(previous);
        const heading = (await title.innerText()).trim();
        previous = heading;
        if (heading !== entry.label) mismatches.push(`"${entry.label}" → "${heading}"`);
      }

      expect(
        mismatches,
        `an owner navigates by clicking: the biggest word on the destination must be the word on the sign.\n`
        + `these say something else: ${mismatches.join(' · ')}`,
      ).toEqual([]);
    });
});
