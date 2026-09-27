// owner-lists-paging.spec.ts —— the owner's lists page on the server (docs/design/paging.md): IP
// bans, API keys, roles, microsites, assets and applications.
//
// Before: each of these GETs returned every row, and headers counted the loaded rows. An instance
// that bans a scraper's range, mints a key per integration, or applies to many jobs grows these
// lists without bound.
//
// Seeding: rows inserted directly — 55 real bans or key mints would test those forms, not the list.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'listspaging@example.com', password: 'correct-horse-battery-staple',
  handle: 'listspaging', fullName: 'Lists Paging Owner',
};
const TOTAL = 55; // one page is 50

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · owner lists page on the server', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
    // 198.51.100.1 is the newest ban; key-1 the newest key.
    execSQL(`INSERT INTO banned_ips (owner_id, ip, reason, created_at)
      SELECT o.id, '198.51.100.' || g, 'scraper', now() - g * interval '1 minute'
      FROM owners o, generate_series(1, ${TOTAL}) g`);
    execSQL(`INSERT INTO api_keys (owner_id, assumed_role_id, label, prefix, secret_hash, created_at)
      SELECT o.id, (SELECT r.id FROM roles r WHERE r.owner_id = o.id LIMIT 1), 'key-' || g,
             'smk_' || g, decode(md5('seed-key-' || g), 'hex'), now() - g * interval '1 minute'
      FROM owners o, generate_series(1, ${TOTAL}) g`);
  });

  test('IP bans: 50, then load more; the header counts all of them', ({ adminPage }) => ipBans(adminPage));
  test('roles: oldest first, 50, then load more; a picker search reaches page 2',
    ({ adminPage }) => roles(adminPage));
  test('microsites: the table pages; the homepage stays on its own card', ({ adminPage }) => microsites(adminPage));
  test('assets: 50, then load more; the header counts them all', ({ adminPage }) => assets(adminPage));
  test('applications: 50, then load more; a search reaches an older one',
    ({ adminPage }) => applications(adminPage));
  test('API keys: 50, then load more', ({ adminPage }) => apiKeys(adminPage));
});

async function ipBans(page: Page): Promise<void> {
  await gotoAdminSection(page, 'ip-bans');
  const rows = page.locator('[data-testid^="ban-row-"]');
  await expect(page.getByTestId('ban-row-198.51.100.1')).toBeVisible();
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId('section-header'), 'the server total').toContainText(String(TOTAL));
  await page.getByTestId('ip-bans-load-more').click();
  await expect(rows).toHaveCount(TOTAL);
  await expect(page.getByTestId(`ban-row-198.51.100.${TOTAL}`)).toBeVisible();
}

async function roles(page: Page): Promise<void> {
  // role-01 is the oldest seeded role; the builtin public role (made at claim) is older still.
  execSQL(`INSERT INTO roles (owner_id, name, created_at)
    SELECT o.id, 'paged-role-' || lpad(g::text, 2, '0'), now() + g * interval '1 minute'
    FROM owners o, generate_series(1, ${TOTAL}) g`);
  await gotoAdminSection(page, 'roles');
  const rows = page.locator('[data-testid^="role-row-"]');
  await expect(page.getByTestId('role-row-paged-role-01')).toBeVisible();
  await expect(rows).toHaveCount(50);
  await page.getByTestId('roles-load-more').click();
  await expect(page.getByTestId(`role-row-paged-role-${TOTAL}`)).toBeVisible();

  await gotoAdminSection(page, 'codes');
  await page.getByRole('button', { name: /new code/i }).click();
  const picker = page.getByTestId('code-field-role');
  const last = picker.locator('option', { hasText: `paged-role-${TOTAL}` });
  await expect(last, 'not on the first page').toHaveCount(0);
  await page.getByTestId('code-field-role-search').fill(`paged-role-${TOTAL}`);
  await expect(last, 'the search finds it').toHaveCount(1);
}

async function microsites(page: Page): Promise<void> {
  // page-01 is the newest seeded page; page-55 the oldest.
  execSQL(`INSERT INTO microsites (owner_id, slug, title, created_at)
    SELECT o.id, 'page-' || lpad(g::text, 2, '0'), 'Page ' || g, now() - g * interval '1 minute'
    FROM owners o, generate_series(1, ${TOTAL}) g`);
  await gotoAdminSection(page, 'microsites');
  const rows = page.locator('[data-testid^="microsite-row-"]');
  await expect(page.getByTestId('microsite-row-page-01')).toBeVisible();
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId('microsite-homepage-card')).toBeVisible();
  await page.getByTestId('microsites-load-more').click();
  await expect(page.getByTestId(`microsite-row-page-${TOTAL}`)).toBeVisible();
  await expect(page.getByTestId('microsite-row-home'), 'the homepage is not a table row').toHaveCount(0);
}

async function assets(page: Page): Promise<void> {
  execSQL(`INSERT INTO assets (owner_id, kind, storage_key, content_type, original_filename, created_at)
    SELECT o.id, 'attachment', 'seed/' || g, 'application/pdf', 'doc-' || g || '.pdf',
           now() - g * interval '1 minute'
    FROM owners o, generate_series(1, ${TOTAL}) g`);
  await gotoAdminSection(page, 'assets');
  const cards = page.locator('[data-testid^="asset-card-"]');
  await expect(cards).toHaveCount(50);
  await expect(page.getByTestId('section-header')).toContainText(String(TOTAL));
  await page.getByTestId('assets-load-more').click();
  await expect(cards).toHaveCount(TOTAL);
}

async function applications(page: Page): Promise<void> {
  // One code per application (the code is the application's invitation; unique per row).
  execSQL(`WITH codes AS (
      INSERT INTO access_codes (owner_id, code, slug, label, assumed_role_id)
      SELECT o.id, 'APP-' || g, 'app-' || g, 'app ' || g,
             (SELECT r.id FROM roles r WHERE r.owner_id = o.id LIMIT 1)
      FROM owners o, generate_series(1, ${TOTAL}) g
      RETURNING id, owner_id, label)
    INSERT INTO applications (owner_id, access_code_id, job_snapshot, resume_content, status, created_at)
    SELECT c.owner_id, c.id,
           jsonb_build_object('company', 'Company ' || split_part(c.label, ' ', 2), 'title', 'Engineer'),
           '{"identity":{"name":"Seed","email":"","phone":"","location_line":""},"summary":"",
             "works":[],"educations":[],"skills":[],"social":[],"custom":[]}'::jsonb,
           'pending', now() - split_part(c.label, ' ', 2)::int * interval '1 minute'
    FROM codes c`);
  await gotoAdminSection(page, 'applications');
  const rows = page.locator('[data-testid^="application-row-"]');
  await expect(rows).toHaveCount(50);
  await page.getByTestId('applications-load-more').click();
  await expect(rows).toHaveCount(TOTAL);

  await page.getByTestId('applications-search').fill(`Company ${TOTAL}`);
  await expect(rows, 'the search reaches the oldest application').toHaveCount(1);
}

async function apiKeys(page: Page): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  const panel = page.getByTestId('api-keys-panel');
  const rows = panel.locator('[data-testid^="api-key-revoke-"]');
  await expect(panel.getByTestId('api-key-revoke-key-1')).toBeVisible();
  await expect(rows).toHaveCount(50);
  await panel.getByTestId('api-keys-load-more').click();
  await expect(rows).toHaveCount(TOTAL);
  await expect(panel.getByTestId(`api-key-revoke-key-${TOTAL}`)).toBeVisible();
}
