// seo-domain-link.spec.ts — the "edit on the site block →" link on the
// "canonical host" row in /admin/seo must land on the **real** editor, not a 404.
//
// The public-URL editor lives in /admin/account's site block (PublicURLEditor —
// `public-url-display` / `public-url-editor` — + HandleEditor + DomainEditor), moved
// there when the homepage became a custom page. The SEO section's canonical-host edit
// link must reach that real editor.
//
// Criterion: click "edit →" on /admin/seo's canonical-host row, and assert it lands on
// the **real** editor surface (`public-url-display` visible / URL is /admin/account).
// What's asserted is the GOOD outcome (reaching the real editor), not merely "no error
// was thrown".

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'seo-domain-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'seodomain',
  fullName: 'Seo Domain Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /seo · the "edit on the Domain section" link must reach a real editor', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('following the canonical-host edit link lands on the real public-URL editor, not a 404',
    linkReachesEditor);
});

// linkReachesEditor — click the canonical-host edit link, and assert it reaches the
// real editor surface.
async function linkReachesEditor({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'seo');
  await expect(page.getByTestId('seo-canonical')).toBeVisible({ timeout: 10_000 });

  const link = page.getByTestId('seo-canonical-edit');
  // Sanity on the current state: the link actually renders (a bad selector would go
  // red right here, rather than silently turning green).
  await expect(link).toBeVisible();
  // Record the href for the failure message — currently a dead link, /admin/domain.
  const href = await link.getAttribute('href');

  // Follow the link (a real user click → full-page navigation; it's an `<a>`, not a
  // <Link>).
  await link.click();

  // GOOD outcome: lands on the real public-URL / domain editor. Right now
  // href=/admin/domain → 404, public-url-display never appears → this times out RED.
  await expect(
    page.getByTestId('public-url-display'),
    `the canonical-host edit link (href="${href ?? ''}") did not land on the real editor — `
    + `the public-URL / domain editor lives in the /admin/account site block`,
  ).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/admin\/account(\/|\?|$)/);
}
