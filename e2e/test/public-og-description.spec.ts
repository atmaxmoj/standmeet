// public-og-description.spec.ts — the public root page `/`'s `<meta
// name="description">` must reflect the owner's **actual** page content (the hero
// prose), not a fixed string identical across every instance.
//
// rot-C3: the root page's meta description is currently the hardcoded constant in
// `layout.tsx`, `'A personal page that argues back.'` — the root `page.tsx` has no
// `generateMetadata`, so this constant is the site-root description for every
// instance, with no relation whatsoever to who the owner is or what the page says.
// Meanwhile `/admin/seo` even tells the owner the og:description "Uses your page
// tagline." and points them at `/admin/page` to change it — but there is no
// top-level page `tagline` field at all, and even if there were, the description
// wouldn't move (it's that constant). The field that should actually drive the
// description is **hero_prose** (which the owner edits at `/admin/page`, testid
// `hero-prose`, and is exactly the text the root page's `Hero` already renders).
// The wiki / output landing pages have long been honest about deriving their
// description from real content inside `generateMetadata`; the root page is the
// only surface still painting a constant.
//
// Criterion (chosen: shape (b), edit → assert, closest to the existing
// page-edit.spec round-trip pattern, and only needs a single instance, no need to
// claim two instances to compare): at `/admin/page`, change the hero prose to a
// unique sentence, save, do a full navigation to `/`, and read the content of
// `<meta name="description">` — it must **contain** that unique sentence, and must
// **not** be the fixed constant. Right now the code paints the constant → doesn't
// contain the unique sentence → RED. Once fixed (root page gains a
// generateMetadata deriving it from hero_prose) → GREEN.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'og-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ogowner',
  fullName: 'OG Owner',
};

// A unique hero prose (< 160 chars, so that even a fix using
// hero_prose.slice(0,160) still keeps the leading fragment).
const HERO_PROSE =
  'I turn quiet obsessions into shipped systems — ask me anything about distributed consensus.';
// The leading fragment that must show up in the meta content (robust against a fix
// like .slice(0,160)).
const PROSE_FRAGMENT = 'I turn quiet obsessions into shipped systems';
// The hardcoded constant identical across every instance — the meta description must
// never be this.
const SHIPPED_CONSTANT = 'A personal page that argues back.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('public root · the meta description reflects the owner\'s prose, not a shipped constant', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('edit hero prose in /admin/page ⇒ the public root meta description carries it (not the constant)',
    metaDescriptionFollowsProse);
});

// metaDescriptionFollowsProse — edit the hero prose, save, navigate to `/`, and
// assert that `<meta name="description">` reflects the owner's words rather than
// the fixed constant.
async function metaDescriptionFollowsProse({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'page');
  await editHeroProse(page, HERO_PROSE);

  await goto(page, '/');
  const description = await metaDescription(page);

  expect(
    description,
    `the public root's meta description must carry the owner's hero prose; got ${JSON.stringify(description)} `
    + '— a constant here means layout.tsx\'s hardcoded description is still the site-root description '
    + '(the root page has no generateMetadata deriving it from hero_prose)',
  ).toContain(PROSE_FRAGMENT);
  // guard: explicitly rule out the fixed string identical across every instance
  // (guards against a future regression back to the constant).
  expect(description, 'the meta description must not be the shipped-in constant')
    .not.toContain(SHIPPED_CONSTANT);
}

// editHeroProse — same pattern as page-edit.spec: fill the hero-prose textarea, save,
// wait for saved.
async function editHeroProse(page: Page, prose: string): Promise<void> {
  const textarea = page.getByTestId('hero-prose');
  await expect(textarea).toBeVisible({ timeout: 5_000 });
  await textarea.fill(prose);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 5_000 });
}

// metaDescription — reads the content of `<meta name="description">` in the root
// page's `<head>`.
async function metaDescription(page: Page): Promise<string> {
  const meta = page.locator('meta[name="description"]');
  await expect(meta).toHaveCount(1, { timeout: 10_000 });
  return (await meta.getAttribute('content')) ?? '';
}
