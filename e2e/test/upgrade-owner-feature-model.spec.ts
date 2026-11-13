// upgrade-owner-feature-model.spec.ts —— old volume + new code: deploying creates the
// owner_feature_models table on an instance that predates it, and a feature→model pin round-trips
// (write then read) through the new table — without the fresh-volume shortcut (schema.sql already has
// the table) that would prove nothing about the migration path
// ([[schema-lives-in-the-volume-not-the-image]]).
//
// Path under test = an already-running instance rolled back to its pre-migration shape (table
// dropped, ledger row deleted), then exactly ONE action — restart the backend (= deploy;
// pgstore.Migrate runs on startup).
//
// Order-sensitive: the DB is briefly without the table between downgrade and restart; e2e runs
// workers:1 serially — do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const MIGRATION = '2026-11-13-owner-feature-model.sql';
const TABLE = 'owner_feature_models';

const OWNER = {
  email: 'featuremodel@example.com', password: 'correct-horse-battery-staple',
  handle: 'featuremodel', fullName: 'Feature Model Owner',
};

function tableExists(): boolean {
  return querySQL(
    `SELECT count(*) FROM information_schema.tables ` +
    `WHERE table_name = '${TABLE}'`,
  ) === '1';
}
function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}
function ownerID(): string {
  return querySQL(`SELECT id FROM owners WHERE email = '${OWNER.email}'`);
}

// downgrade —— the real shape of "this instance hasn't upgraded to this version yet": the table never
// existed, so drop it and delete the ledger row so startup actually re-runs the migration.
function downgrade(): void {
  execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · deploying creates owner_feature_models and a pin round-trips', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await loginAPI(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy → the table is created and a feature→model pin round-trips',
    async () => {
      const owner = ownerID();
      expect(owner.length, 'the owner was claimed').toBeGreaterThan(0);

      // Roll back to the pre-migration shape. It must actually take effect
      // ([[assertion-that-cannot-fail]]).
      downgrade();
      expect(tableExists(), 'downgrade dropped the table (pre-migration shape)').toBe(false);
      expect(ledgerRows(), 'ledger row gone → startup re-runs the migration, i.e. we test upgrade')
        .toBe(0);

      // Upgrade = deploy. No other action.
      restartBackend();

      // The deploy re-created the table and recorded the migration.
      expect(tableExists(), 'the migration re-created the table').toBe(true);
      expect(ledgerRows()).toBe(1);

      // A feature→model pin round-trips: a global pin and a role override of the same feature coexist
      // (the (owner_id, role_id, feature) PK), and the cascade read prefers the role over the global.
      execSQL(
        `INSERT INTO ${TABLE} (owner_id, role_id, feature, model) ` +
        `VALUES ('${owner}', '', 'screen_assistant', 'claude-sonnet-5-5')`,
      );
      execSQL(
        `INSERT INTO ${TABLE} (owner_id, role_id, feature, model) ` +
        `VALUES ('${owner}', 'role-x', 'screen_assistant', 'claude-opus-5-5')`,
      );
      const globalPin = querySQL(
        `SELECT model FROM ${TABLE} WHERE owner_id = '${owner}' AND role_id = '' ` +
        `AND feature = 'screen_assistant'`,
      );
      expect(globalPin, 'the feature global pin round-trips').toBe('claude-sonnet-5-5');

      // The cascade: role override beats the global for that role (role_id DESC, LIMIT 1).
      const resolved = querySQL(
        `SELECT model FROM ${TABLE} WHERE owner_id = '${owner}' ` +
        `AND feature = 'screen_assistant' AND role_id IN ('role-x', '') ` +
        `ORDER BY role_id DESC LIMIT 1`,
      );
      expect(resolved, 'the role override wins the cascade over the global pin').toBe('claude-opus-5-5');
    });
});
