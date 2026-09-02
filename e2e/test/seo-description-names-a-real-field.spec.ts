// seo-description-names-a-real-field.spec.ts -- the X in "edit it under X"
// must actually exist on that page.
//
// The og:description block on /admin/seo reads "Uses your page **tagline**",
// with a link below pointing to /admin/page. That page has nothing called
// tagline -- the field is called **prose** (`prose · 1–3 sentences` in the
// hero section), and the backend field is `hero_prose`. An owner following
// that sentence would find nothing matching what it says.
//
// This is the hardest kind of names-that-lie defect for an assertion to
// catch: each page renders fine on its own, and **only reading both pages
// together** reveals the mismatch. So this test case deliberately spans two
// pages: read the noun off page A, then go look for it on page B.
//
// Outside item corpus-render, public-og-description check 2's backing test
// has stayed marked `gap` the whole time.

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'seo-noun@example.com', password: 'correct-horse-battery-staple',
  handle: 'seonoun', fullName: 'Seo Noun Owner',
};

// NOUN -- the noun the SEO copy should use, which is also the label on that
// field in the page editor.
const NOUN = 'hero prose';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('seo · the og:description copy names a field that exists', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the noun on /admin/seo is findable on the page it sends you to', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'seo');
    const block = adminPage.getByTestId('seo-description');
    await expect(block).toBeVisible();

    const copy = (await block.innerText()).toLowerCase();
    expect(copy, 'the copy must name the field that actually feeds og:description').toContain(NOUN);
    // `tagline` does not exist anywhere in this product. Leaving it in sends
    // the owner off looking for something that isn't there.
    expect(copy, 'no field is called a tagline anywhere in this product').not.toContain('tagline');

    // Follow its own link -- the noun has to be findable on the page it lands on.
    await block.getByRole('link').click();
    await adminPage.waitForURL('**/admin/page');
    // Wait for the editor to actually render before reading -- at the moment
    // of landing, main only has the title, and reading then would say
    // "hasn't finished drawing yet", not "the word isn't there".
    await expect(adminPage.getByTestId('hero-prose')).toBeVisible();
    const editor = (await adminPage.locator('main').innerText()).toLowerCase();
    expect(editor, 'the noun must be findable on the page the copy sends the owner to')
      .toContain('prose');
  });
});
