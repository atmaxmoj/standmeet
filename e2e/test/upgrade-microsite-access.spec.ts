// upgrade-microsite-access.spec.ts — an old volume + new code: the deploy carries the
// "open without an access code" migration (`2026-09-28-microsite-access.sql`: one table + the one
// function that decides the default).
//
// The full suite only exercises a fresh volume (schema.sql), which proves nothing about an upgrade.
// Method (mirrors upgrade-public-conversation-policy): on a DB that already has an owner, a page
// with a code bound (like the owner's cover letter) and a page without, roll back to the real
// pre-upgrade shape — drop the table and the function, delete this migration's ledger row — then do
// exactly one thing: restart the backend (= deploy). The migration must arrive through the real
// mechanism, never applied by the test.
//
// What the upgrade must do for pages that already exist (owner decision 2026-09-28): the page with
// a code bound comes out closed, the page without stays open — with no row written for either, so
// the owner's later choice is still the only thing a row ever records.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createMicrosite } from '@/fixtures/admin-mutations';
import { createCode } from '@/fixtures/codes';
import { bindCodeToPage } from '@/fixtures/microsite-rig';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const MIGRATION = '2026-09-28-microsite-access.sql';
const TABLE = 'microsite_access';
const FUNC = 'microsite_opens_without_code';
const BOUND = 'cover-letter';
const UNBOUND = 'notes';

const OWNER = {
  email: 'access-upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'accessupgrader',
  fullName: 'Access Upgrader',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

function count(sql: string): number {
  return Number(querySQL(sql));
}

test.describe('upgrade · deploying the new version adds "open without an access code" to a live instance', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    for (const slug of [BOUND, UNBOUND]) await createMicrosite(request, csrf, { slug, title: slug });
    const code = await createCode(request, csrf, { code: 'COVER-UPG', label: 'cover' });
    await bindCodeToPage(request, csrf, code.id, BOUND);
    await request.dispose();
  });

  // Safety net: if a test dies mid-run the DB is left in the old shape; one more restart fixes it.
  test.afterAll(() => { restartBackend(); });

  test('an old volume with a bound and an unbound page + a deploy → schema applied', () => {
    // Roll back to the pre-upgrade shape — it must actually take effect, or this is a fake,
    // permanently-green upgrade test.
    execSQL(`DROP FUNCTION IF EXISTS ${FUNC}(uuid)`);
    execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='${TABLE}'`),
      'pre-state not built: the table is still there').toBe(0);
    expect(count(`SELECT count(*) FROM pg_proc WHERE proname='${FUNC}'`),
      'pre-state not built: the function is still there').toBe(0);
    expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`),
      'the ledger still has the row; startup would skip it').toBe(0);

    // Upgrade = deploy. No other action.
    restartBackend();

    expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='${TABLE}'`)).toBe(1);
    expect(count(`SELECT count(*) FROM pg_proc WHERE proname='${FUNC}'`)).toBe(1);
    expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
    expect(count(`SELECT count(*) FROM ${TABLE}`), 'the upgrade writes no choice for the owner').toBe(0);
  });

  test('…and existing pages come out as decided: the bound one closed, the other open; the switch writes',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'microsites');
      const bound = page.getByTestId(`microsite-without-code-${BOUND}`);
      const unbound = page.getByTestId(`microsite-without-code-${UNBOUND}`);
      await expect(bound, 'the page with a code bound starts closed').toHaveAttribute('aria-checked', 'false');
      await expect(unbound, 'the page without stays open').toHaveAttribute('aria-checked', 'true');

      // The new table is writable on the upgraded instance.
      await bound.click();
      await expect(bound).toHaveAttribute('aria-checked', 'true');
      expect(count(`SELECT count(*) FROM ${TABLE} WHERE open_without_code`)).toBe(1);
    });
});
