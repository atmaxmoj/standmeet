// admin-nav-marks-the-page-you-are-on -- the sidebar must mark **the section you are on**.
//
// F-N-1: `/admin/subjectivity` highlights `dashboard` instead. The cause is not a bug in
// the highlight logic, but **the same fact stored twice**: the sidebar has its own
// `NAV_GROUPS` (which includes subjectivity), while `AdminShell` keeps a separately
// hand-copied `KNOWN_SLUGS` to map paths to slugs -- that copy is missing this entry,
// so it falls back to "unknown -> dashboard". The two lists drifted, and neither knows it.
//
// This test **clicks through every section in the sidebar one by one**, not just the
// subjectivity section: a missed copy like this has no reason to happen only once, and
// whoever adds the next section won't know a second list exists either.
// The assertion uses `aria-current="page"` -- that is the semantics of "current page",
// not the styling of some class.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'nav-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'navowner',
  fullName: 'Nav Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sidebar marks the section you are on', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('every section in the sidebar marks itself when you are on it (F-N-1)',
    async ({ adminPage }) => {
      const slugs = await sidebarSlugs(adminPage);
      expect(slugs.length, 'the sidebar has sections to check').toBeGreaterThan(15);
      const wrong: string[] = [];
      for (const slug of slugs) {
        await gotoAdminSection(adminPage, slug);
        const marked = await markedSlug(adminPage);
        marked === slug || wrong.push(`${slug} → marked "${marked}"`);
      }
      expect(wrong, `sections whose sidebar entry is not the one marked:\n${wrong.join('\n')}`)
        .toEqual([]);
    });
});

// sidebarSlugs -- reads slugs from the links **as rendered** in the sidebar, not from
// yet another list copied out of the code. Copying a third list would be this exact bug.
async function sidebarSlugs(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid^="admin-nav-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid') ?? ''),
  );
  // `admin-nav-toggle` is the mobile hamburger button, not a section — it also starts with
  // `admin-nav-`, so drop it (clicking it on desktop, where it's lg:hidden, would just hang).
  return [...new Set(ids.map((id) => id.replace(/^admin-nav-/, '')).filter(Boolean))]
    .filter((slug) => slug !== 'toggle');
}

async function markedSlug(page: Page): Promise<string> {
  const href = await page.locator('nav a[aria-current="page"]').first()
    .getAttribute('href')
    .catch(() => null);
  return (href ?? '(none)').replace(/^\/admin\//, '');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}
