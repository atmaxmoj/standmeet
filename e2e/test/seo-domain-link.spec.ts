// seo-domain-link.spec.ts — the "edit on the Domain section →" link on the
// "canonical host" row in /admin/seo must land on the **real** editor, not a 404.
//
// rot-C2 (HIGH): the `seo-canonical-edit` link at SeoSection.tsx:137 has
// href="/admin/domain", but **there is no /admin/domain route at all** (no domain/
// directory under app/src/app/admin/). The actual place to edit the public URL /
// domain is /admin/page (PageSection → SiteBlock → PublicURLEditor
// (`public-url-display` / `public-url-editor`) + DomainEditor). So the only entry
// point the SEO section points the owner to for editing the canonical host is a dead
// link that 404s on click.
//
// RED criterion: click "edit on the Domain section →" on /admin/seo, and assert it
// lands on the **real** editor surface (`public-url-display` visible / URL is
// /admin/page). Right now href=/admin/domain → 404, that testid never appears →
// RED. What's asserted is the GOOD outcome (reaching the real editor), not merely
// "no error was thrown".

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
    + `/admin/domain is not a route; the public-URL / domain editor lives under /admin/page `
    + `(SeoSection.tsx:137 hard-codes a non-existent /admin/domain)`,
  ).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/admin\/page(\/|\?|$)/);
}
