// nav-page-vs-pages.spec.ts -- every admin nav entry lands on a section whose heading is the
// label you clicked.
//
// History: this file used to guard the two confusable "page(s)" entries -- slug `page` ("public
// page", the built-in landing page) vs slug `microsites` ("pages", the microsites at /p/{slug}).
// The homepage is now a custom page, so the built-in `page` entry (and its editor) is gone -- the
// confusion is resolved by removal, and that describe with it.
//
// What remains is F-N-3's lesson, which is the durable one: a guard that only reads the nav
// LABELS stops at the door -- once the signs were renamed, the headings BEHIND them stayed wrong
// and the guard stayed green. So this walks the whole nav: click each entry, and the destination's
// own heading (data-testid="section-title") must state that entry's label.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';

const OWNER = {
  email: 'nav-labels@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'navlabels',
  fullName: 'Nav Labels Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

const NAV_ENTRIES: readonly { slug: string; label: string }[] = [
  { slug: 'dashboard', label: 'dashboard' },
  { slug: 'raw', label: 'raw' },
  { slug: 'wiki', label: 'wiki' },
  { slug: 'subjectivity', label: 'subjectivity' },
  { slug: 'writings', label: 'writings' },
  { slug: 'output', label: 'outputs' },
  { slug: 'microsites', label: 'custom pages' },
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
