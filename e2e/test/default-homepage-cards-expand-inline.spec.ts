// default-homepage-cards-expand-inline.spec.ts —— I (owner-reported): the default homepage's
// corpus cards must open **in place**, not redirect away ("clicking straight into it is just a redirect, that's terrible").
//
// This builds the REAL pre-installed default homepage (the embedded template that claim installs
// as the reserved `home` page — no file is overwritten here, so the template itself is under
// test), publishes it, and drives it in a browser:
//   1. a published corpus entry shows up as a card (title + excerpt);
//   2. clicking the card reveals the note's body inline (pulled with the SDK's keyless
//      fetchWikiLanding) — and the page does NOT navigate away.
//
// If the homepage regressed to a hard <a href="/wiki/…"> redirect, step 2's assertion that the
// body appears while the URL stays on /api/v1/homepage would fail.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'homeinline@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeinline', fullName: 'Home Inline Owner',
};

const NOTE_TITLE = 'The Deterministic State Holder';
// A distinctive sentence that lives ONLY in the note body — never in the card excerpt — so seeing
// it on screen proves the body was pulled inline, not that the excerpt was already showing.
const NOTE_BODY = 'Keeping every fact in exactly one place is the whole discipline here inline-proof.';

test.describe.configure({ timeout: 120_000 });

// A Slice 4 landed the root-serving cutover (`/` → the live home page + `/assets/*` proxy), so this
// now drives the REAL homepage at the site root `/`, exactly as a visitor to the owner's domain
// sees it — the default template (which composes the SDK widgets) + inline card expansion.
test.describe('the default homepage opens corpus cards inline (no redirect)', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'homeinline-seed');
    const sid = await initMCP(request, token);
    const note = await seedWiki(request, token, sid, { title: NOTE_TITLE, body: NOTE_BODY });
    await publishEntry(request, token, sid, {
      genre: 'wiki', id: note.wikiID, excerpt: 'a curated card excerpt',
    });
    // No home is materialized at claim now; `/` serves DefaultHome (current code) directly, so there
    // is nothing to build — the published corpus above is all this needs.
    await request.dispose();
  });

  test('a card shows the note, and clicking it reveals the body inline without navigating',
    async ({ page }) => {
      await goto(page, '/'); // the site root — the homepage as a visitor to the domain sees it

      // The card is there (title from fetchCorpusCards, via CorpusWidget).
      const title = page.getByText(NOTE_TITLE, { exact: false });
      await expect(title.first()).toBeVisible({ timeout: 20_000 });

      // The body sentence is NOT on screen yet (only the excerpt is).
      await expect(page.getByText(NOTE_BODY, { exact: false })).toHaveCount(0);

      // Open the card in place.
      await title.first().click();

      // The body was pulled inline (fetchWikiLanding) — and we never left the homepage.
      await expect(page.getByText(NOTE_BODY, { exact: false }).first())
        .toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname,
        'opening a card must not navigate away from the homepage root').toBe('/');
    });

  // The CorpusWidget renders its cards in `<ol className="flex flex-col">`. `flex-col` is used only
  // inside the SDK widget, not in the owner's App.tsx — and Tailwind v4 doesn't scan node_modules by
  // default, so without `@source` for the SDK it compiled to NOTHING and the list fell back to
  // flex-direction:row: the corpus cards crammed into a horizontal strip (a real prod defect). A
  // text/behaviour assertion can't see this ([[text-assertion-cannot-see-layout]]) — assert the
  // computed direction. RED without the theme.css @source; GREEN with it.
  test('the corpus card list stacks vertically (SDK flex-col actually compiles)',
    async ({ page }) => {
      await goto(page, '/');
      await expect(page.getByText(NOTE_TITLE, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      const dir = await page.evaluate(() => {
        const ol = [...document.querySelectorAll('ol')].find((o) => getComputedStyle(o).display === 'flex');
        return ol ? getComputedStyle(ol).flexDirection : 'no-flex-ol';
      });
      expect(dir, 'the corpus card <ol> must be flex-direction:column, not a horizontal row').toBe('column');
    });

  // (The old EDIT-ME identity sections — projects / where-I-am / contact — were a materialized
  // starter template's placeholder prose. DefaultHome deliberately drops them (owner: no placeholder
  // junk on an unedited home); an owner who wants them creates their own `home` microsite.)
});
