// upgrade-microsite-build-lease.spec.ts — an old volume + new code: the deploy carries the build
// lease migration (`2026-09-26-microsite-build-lease.sql`, one new column microsite_builds.claimed_at).
//
// The full suite only exercises a fresh volume (schema.sql), which proves nothing about an upgrade.
// Method (mirrors upgrade-public-conversation-policy): roll back to the real pre-upgrade shape —
// drop the column AND delete this migration's ledger row — then do exactly one thing: restart the
// backend (= deploy). The migration must arrive through the real mechanism, never applied here.
//
// The live instance carries the very row this migration exists for: a build stuck in `building`
// since before the upgrade, left by a builder that died (prod had one — flexmesh, 2026-09-26). The
// upgrade must not strand it: after the deploy that page gets built.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run, and the builder is stopped.

import { execSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { claim, login as loginAPI } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { queueBuild } from '@/fixtures/microsite-rig';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-09-26-microsite-build-lease.sql';
const OWNER = {
  email: 'lease-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'leaseupgrader', fullName: 'Lease Upgrader',
};
const SLUG = 'stuck-before-upgrade';
const SOURCE = `export default function App() {
  return <main>Stuck before the upgrade, built after it.</main>;
}`;

function columnCount(): number {
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'microsite_builds' AND column_name = 'claimed_at'`,
  ));
}

function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}

test.describe('upgrade · a build stuck before the deploy is built after it', () => {
  test.describe.configure({ mode: 'serial', timeout: 400_000 });

  let request: APIRequestContext;
  let csrf = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  });

  // Safety net: a test that dies mid-run leaves the old shape and a stopped builder behind.
  test.afterAll(async () => {
    restartBackend();
    execSync('make -C .. dev-restart-svc SVC=builder', { stdio: 'inherit' });
    await request.dispose();
  });

  test('old volume with an orphaned `building` row + a deploy → schema applied, the page gets built', async () => {
    // The builder is stopped so nothing builds the page before it is orphaned.
    execSync('make -C .. dev-stop-svc SVC=builder', { stdio: 'inherit' });
    const headers = { 'X-Csrftoken': csrf };
    const buildID = await queueBuild(request, csrf, SLUG, SOURCE);

    // Pre-upgrade state: the old builder took this build and died, so it sits in `building`.
    // Then roll back to the old schema — it must actually take effect, or this is a fake,
    // permanently-green upgrade test.
    execSQL(`UPDATE microsite_builds SET status = 'building' WHERE id = '${buildID}'`);
    execSQL('ALTER TABLE microsite_builds DROP COLUMN IF EXISTS claimed_at');
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(columnCount(), 'pre-state not built: the column is still there').toBe(0);
    expect(ledgerRows(), 'the ledger still has the row; startup would skip it').toBe(0);

    // Upgrade = deploy: the new backend, then the new builder. No other action.
    restartBackend();
    execSync('make -C .. dev-restart-svc SVC=builder', { stdio: 'inherit' });

    expect(columnCount()).toBe(1);
    expect(ledgerRows()).toBe(1);
    await expect.poll(async () => {
      const res = await request.get(`${BACKEND}/api/admin/microsites/builds/${buildID}`, { headers });
      return ((await res.json()) as { status?: string }).status ?? '';
    }, {
      timeout: 240_000, intervals: [2_000],
      message: 'the build stuck before the upgrade was never built after it',
    }).toBe('built');
  });
});
