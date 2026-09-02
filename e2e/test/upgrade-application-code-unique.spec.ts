// upgrade-application-code-unique.spec.ts —— old volume + new code: deploying brings up
// the unique constraint on applications.access_code_id, and existing application data is
// left untouched.
//
// The visitor-side resume tool relies on GetApplicationByAccessCode(:one) to look up "the"
// application for a session's code. That isolation rests on the invariant "one code, one
// application", and that invariant must be guaranteed by a **constraint** — it cannot rely
// on the convention that "commit happens to issue a fresh code every time". So both go-live
// paths must hold for every schema change: a brand-new volume (schema.sql) + an
// already-running instance (backend/db/migrations/, applied by pgstore.Migrate on startup).
// This test covers path ②: a database with real data, rolled back to its pre-upgrade shape,
// then **exactly one action: restart the backend** (= deploy).
//
// Warning: don't run that SQL by hand — that would exercise a path that doesn't exist in
// prod. Upgrading has exactly one path: restartBackend. Order-sensitive: while this spec
// runs, the database is briefly broken; e2e runs workers:1 serially, do not change that to
// parallel.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const MIGRATION = '2026-09-01-application-code-unique.sql';

const OWNER = {
  email: 'appuniqueupgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'appuniqueupgrade', fullName: 'App Unique Upgrade Owner',
};
const CODE = 'UPGRADE-APP-UNIQ';

// uniqueIndexExists —— the migration's product: the unique index on access_code_id.
function uniqueIndexExists(): boolean {
  return querySQL(`SELECT to_regclass('public.applications_access_code_uniq') IS NOT NULL`) === 't';
}
// uniqueIndexIsUnique —— existence is not enough: a name can lie. Assert it is actually UNIQUE, so a
// second application on one code would be rejected (the invariant isolation rests on).
function uniqueIndexIsUnique(): boolean {
  return querySQL(
    `SELECT indisunique FROM pg_index ` +
    `WHERE indexrelid = 'public.applications_access_code_uniq'::regclass`,
  ) === 't';
}
function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}
function applicationRows(codeID: string): number {
  return Number(querySQL(
    `SELECT count(*) FROM applications WHERE access_code_id = '${codeID}'`,
  ));
}

// downgrade — rolls back to the real shape of "this instance hasn't upgraded to this
// version yet": the unique index is swapped back for a non-unique one, and the ledger row is
// deleted (that's exactly what a not-yet-upgraded instance looks like: the ledger exists,
// just without this row). Not a single application data row is touched.
function downgrade(): void {
  execSQL(`DROP INDEX IF EXISTS applications_access_code_uniq`);
  execSQL(`CREATE INDEX IF NOT EXISTS applications_access_code_idx ON applications(access_code_id)`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · deploying brings up the application-code unique constraint', () => {
  test.describe.configure({ timeout: 300_000 });
  let codeID = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'up-role', description: 'wiki', corpus_uris: ['wiki://**'],
    });
    const c = await createCode(request, csrf, { code: CODE, label: 'up', assumed_role_id: role.id });
    codeID = c.id;
    await request.dispose();
  });

  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy → the unique index comes back, the application row survives',
    async () => {
      // Real data on this instance: one committed application on the code.
      const ownerID = querySQL(`SELECT owner_id FROM access_codes WHERE code = '${CODE}'`);
      execSQL(
        `INSERT INTO applications (owner_id, access_code_id, job_snapshot, resume_content) ` +
        `VALUES ('${ownerID}', '${codeID}', '{}'::jsonb, '{"summary":"UPGRADE-SURVIVOR"}'::jsonb)`,
      );
      expect(applicationRows(codeID), 'seeded one application').toBe(1);

      // Roll back to the old shape. It must actually take effect
      // ([[assertion-that-cannot-fail]]).
      downgrade();
      expect(uniqueIndexExists(), '前置没退干净：唯一索引还在').toBe(false);
      expect(ledgerRows(), '账本还留着这条，启动会跳过 → 没在测升级').toBe(0);

      // Upgrade = deploy. No other action.
      restartBackend();

      // The deploy brought the migration up + recorded it in the ledger.
      expect(uniqueIndexExists(), '唯一索引随部署上来了').toBe(true);
      expect(uniqueIndexIsUnique(), '它是真的 UNIQUE，不只是同名的索引').toBe(true);
      expect(ledgerRows()).toBe(1);

      // Old data survives intact: the application from before the upgrade is still there.
      expect(applicationRows(codeID), '升级不动已有的 application 数据').toBe(1);
    });
});
