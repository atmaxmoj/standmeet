// upgrade-access-code-slug.spec.ts —— old volume + new code: deploying backfills a distinct landing
// `slug` onto every existing access code, and brings up the per-owner unique index — without losing
// or renaming a single code.
//
// The per-code slug (2026-09-06-access-code-slug.sql) has Go unit coverage for DeriveSlug (how a
// NEW code's slug is chosen), but the UPGRADE path was untested: an instance created before this
// migration has codes with no slug, and the migration must give each one a distinct value so the
// `(owner_id, slug)` unique index can even be built. An empty-volume green (schema.sql already has
// the column) proves nothing about that backfill ([[schema-lives-in-the-volume-not-the-image]]).
//
// Path under test = ② an already-running instance: real code rows, rolled back to their
// pre-upgrade shape (no slug column, no index, no ledger row), then exactly ONE action —
// restart the backend (= deploy; pgstore.Migrate runs on startup). Not run by hand: that would
// exercise a path prod never takes.
//
// Order-sensitive: the DB is briefly broken between downgrade and restart; e2e runs workers:1
// serially — do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const MIGRATION = '2026-09-06-access-code-slug.sql';
const INDEX = 'access_codes_owner_slug_idx';

const OWNER = {
  email: 'slugupgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'slugupgrade', fullName: 'Slug Upgrade Owner',
};

// expectedSlug —— the migration's backfill formula: the first 12 hex chars of the row uuid
// (dashes removed). Recomputed here so the assertion pins the actual derivation, not just
// "non-empty" ([[assertion-that-cannot-fail]]).
function expectedSlug(id: string): string {
  return id.replace(/-/g, '').slice(0, 12);
}
function slugOf(codeID: string): string {
  return querySQL(`SELECT slug FROM access_codes WHERE id = '${codeID}'`);
}
function slugColumnExists(): boolean {
  return querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name = 'access_codes' AND column_name = 'slug'`,
  ) === '1';
}
function uniqueIndexIsUnique(): boolean {
  return querySQL(
    `SELECT indisunique FROM pg_index WHERE indexrelid = 'public.${INDEX}'::regclass`,
  ) === 't';
}
function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}
function codeCount(): number {
  return Number(querySQL(`SELECT count(*) FROM access_codes`));
}

// downgrade —— the real shape of "this instance hasn't upgraded to this version yet": the slug
// column never existed, so drop the index, drop the column (the code rows themselves survive —
// DROP COLUMN removes no rows), and delete the ledger row so startup actually re-runs the migration.
function downgrade(): void {
  execSQL(`DROP INDEX IF EXISTS ${INDEX}`);
  execSQL(`ALTER TABLE access_codes DROP COLUMN IF EXISTS slug`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · deploying backfills a distinct slug onto every existing access code', () => {
  test.describe.configure({ timeout: 300_000 });
  let codeA = '';
  let codeB = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'slug-role', description: 'wiki', corpus_uris: ['wiki://**'],
    });
    const a = await createCode(request, csrf, { code: 'SLUG-UP-A', label: 'a', assumed_role_id: role.id });
    const b = await createCode(request, csrf, { code: 'SLUG-UP-B', label: 'b', assumed_role_id: role.id });
    codeA = a.id;
    codeB = b.id;
    await request.dispose();
  });

  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy → every code gets a distinct uuid-derived slug, none lost',
    async () => {
      const before = codeCount();
      expect(before, 'two codes seeded (plus any public default)').toBeGreaterThanOrEqual(2);

      // Roll back to the pre-slug shape. It must actually take effect ([[assertion-that-cannot-fail]]).
      downgrade();
      expect(slugColumnExists(), 'downgrade removed the slug column (pre-migration shape)').toBe(false);
      expect(ledgerRows(), 'ledger row gone → startup will re-run the migration, i.e. we test upgrade')
        .toBe(0);

      // Upgrade = deploy. No other action.
      restartBackend();

      // The deploy re-added the column, backfilled each row, and brought up the unique index.
      expect(slugColumnExists(), 'the migration re-added the slug column').toBe(true);
      expect(uniqueIndexIsUnique(), 'the per-owner (owner_id, slug) index is really UNIQUE').toBe(true);
      expect(ledgerRows()).toBe(1);

      // Every pre-existing code got a distinct, non-empty slug derived from its uuid — exactly the
      // formula, which (distinct uuids → distinct prefixes) is what lets the unique index be built.
      const slugA = slugOf(codeA);
      const slugB = slugOf(codeB);
      expect(slugA, 'code A backfilled from its uuid').toBe(expectedSlug(codeA));
      expect(slugB, 'code B backfilled from its uuid').toBe(expectedSlug(codeB));
      expect(slugA.length, 'the slug is non-empty').toBe(12);
      expect(slugA === slugB, 'the two backfilled slugs are distinct').toBe(false);

      // No code was lost or duplicated by the upgrade.
      expect(codeCount(), 'the upgrade touched no code rows').toBe(before);
    });
});
