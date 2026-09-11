// upgrade-monitoring-enabled-column.spec.ts — an old volume + new code: the deploy carries the
// monitoring-switch migration (`2026-09-11-monitoring-enabled.sql`, one column on `owners`).
//
// v0.0.1 has shipped, so this schema change has two rollouts: a fresh pg volume (schema.sql runs
// once) and an already-running instance (the new version lands on top). The full suite only ever
// exercises the fresh volume ([[schema-lives-in-the-volume-not-the-image]]: green on an empty volume
// proves nothing about an upgrade). This asserts the second.
//
// Method (mirrors upgrade-homepage-seo-columns): on a DB that already has an owner, roll back to the
// real pre-upgrade shape — drop the column AND delete this migration's ledger row (an un-upgraded
// instance's ledger exists but is missing this row) — then do exactly one thing: restart the
// backend. The migration must reach the instance through the real mechanism, never applied by the
// test itself.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const MIGRATION = '2026-09-11-monitoring-enabled.sql';
const COLUMN = 'monitoring_enabled';

const OWNER = {
  email: 'monitoring-upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitoringupgrader',
  fullName: 'Millicent Upgrader',
};

function columnCount(): number {
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='owners' AND column_name='${COLUMN}'`,
  ));
}

function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}

// downgrade — the real shape of "this instance hasn't upgraded yet": the column is gone AND the
// ledger row is gone (dropping only the column would leave the ledger saying "already applied", so
// startup would skip it — then the test would only prove the ledger works, not the upgrade).
function downgrade(): void {
  execSQL(`ALTER TABLE owners DROP COLUMN IF EXISTS ${COLUMN}`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · deploying the new version adds the monitoring-switch column to a live instance', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // Safety net: if a test dies mid-run the DB is left in the old shape; one more restart fixes it.
  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy of the new version → the deploy applies the schema', () => {
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`)).toBe(OWNER.email);

    // Roll back to the pre-upgrade shape — this must actually take effect, or everything below runs
    // on the new schema anyway and this becomes a fake, permanently-green upgrade test.
    downgrade();
    expect(columnCount(), '前置状态没造出来：列还在,这条测试证明不了任何事').toBe(0);
    expect(ledgerRows(), '账本里还留着这一条,启动时会跳过 —— 那就没在测升级').toBe(0);

    // Upgrade = deploy. No other action.
    restartBackend();

    expect(columnCount()).toBe(1);
    expect(ledgerRows()).toBe(1);
  });

  test('…and after the deploy the old owner is intact and the column defaults to on (collecting)', () => {
    // The old data survived the ALTER.
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`)).toBe(OWNER.email);
    // A row that already existed gets the safe default (true = keep collecting, the shipped
    // behaviour), where adding a NOT NULL column would otherwise blow up. Not 'f': an upgrade must
    // never silently turn an owner's monitoring off.
    expect(querySQL(
      `SELECT monitoring_enabled FROM owners WHERE handle = '${OWNER.handle}'`,
    )).toBe('t');
  });
});
