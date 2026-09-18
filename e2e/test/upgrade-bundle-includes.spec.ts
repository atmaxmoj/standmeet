// upgrade-bundle-includes.spec.ts — an old volume + new code: the deploy carries the
// bundle-nesting migration (`2026-09-17-bundle-includes.sql`, the new `bundle_includes` table).
//
// v0.0.1 has shipped, so this schema change has two rollouts: a fresh pg volume (schema.sql runs
// once) and an already-running instance (the new version lands on top). The full suite only ever
// exercises the fresh volume ([[schema-lives-in-the-volume-not-the-image]]: green on an empty volume
// proves nothing about an upgrade). This asserts the second — and it has teeth, because the new
// code's grant resolution (ResolveMembers → SELECT ... FROM bundle_includes) runs on EVERY visitor
// assembly of a bundle-bound code: if the deploy failed to create the table, a code that already
// carried a bundle before the upgrade would lose ALL its tools (the query errors, the gate fails
// closed). So the upgrade must both create the table AND keep every pre-existing flat bundle working.
//
// Method (mirrors upgrade-homepage-seo-columns): seed a bundle-bound code on the current schema,
// roll back to the real pre-upgrade shape (drop the table AND delete this migration's ledger row),
// restart the backend once (the migration reaches the instance through the real mechanism, never
// applied by the test), then assert the table is back, the old flat bundle still resolves, and the
// new nesting capability works.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames } from '@/fixtures/blocks';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-09-17-bundle-includes.sql';
const RETRIEVAL = 'corpus.retrieval';
const RETRIEVAL_TOOL = 'corpus_search';

const OWNER = {
  email: 'bundle-includes-upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'bundleincupgrader',
  fullName: 'Bruno Upgrader',
};

let csrf = '';

function tableCount(): number {
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.tables WHERE table_name = 'bundle_includes'`,
  ));
}

function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}

// downgrade — the real shape of "this instance hasn't upgraded yet": the table is gone AND the
// ledger row is gone (dropping only the table would leave the ledger saying "already applied", so
// startup would skip it — then the test would only prove the ledger works, not the upgrade).
function downgrade(): void {
  execSQL('DROP TABLE IF EXISTS bundle_includes CASCADE');
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

async function createBundle(
  request: APIRequestContext, name: string, blocks: string[],
): Promise<string> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: assembling the bundle whose upgrade this spec proves
  const res = await request.post(`${BACKEND}/api/admin/bundles`, {
    headers: { 'X-Csrftoken': csrf }, data: { name, blocks },
  });
  if (res.status() !== 201) throw new Error(`create bundle ${name}: ${res.status()}`);
  return (await res.json() as { id: string }).id;
}

async function setIncludes(
  request: APIRequestContext, bundleID: string, includeBundles: string[],
): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: nesting bundles by reference on the upgraded schema
  const res = await request.post(`${BACKEND}/api/admin/bundles/${bundleID}/includes`, {
    headers: { 'X-Csrftoken': csrf }, data: { include_bundles: includeBundles },
  });
  if (res.status() !== 200) throw new Error(`set includes: ${res.status()}`);
}

async function bindCode(request: APIRequestContext, code: string, bundleID: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: binding a code to a bundle by reference
  const res = await request.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf }, data: { code, label: code, bundle_id: bundleID },
  });
  if (res.status() !== 201) throw new Error(`bind code ${code}: ${res.status()}`);
}

async function toolsFor(request: APIRequestContext, code: string, name: string): Promise<string[]> {
  const s = await issueSession(request, { handle: OWNER.handle, mode: 'code', code, visitor_name: name });
  return sessionToolNames(request, s.session_token);
}

test.describe('upgrade · deploying the new version adds the bundle_includes table to a live instance', () => {
  test.describe.configure({ timeout: 300_000 });

  let flatBundleID = '';

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await login(request, OWNER.email, OWNER.password));
    // Seed a FLAT bundle-bound code — the old-shape data an instance carried before nesting existed.
    flatBundleID = await createBundle(request, 'legacy', [RETRIEVAL]);
    await bindCode(request, 'LEGACY-CODE', flatBundleID);
    await request.dispose();
  });

  // Safety net: if a test dies mid-run the DB is left in the old shape; one more restart fixes it.
  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy of the new version → the deploy applies the migration', () => {
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`)).toBe(OWNER.email);

    // Roll back to the pre-upgrade shape — this must actually take effect, or everything below runs
    // on the new schema anyway and this becomes a fake, permanently-green upgrade test.
    downgrade();
    expect(tableCount(), '前置状态没造出来：表还在,这条测试证明不了任何事').toBe(0);
    expect(ledgerRows(), '账本里还留着这一条,启动时会跳过 —— 那就没在测升级').toBe(0);

    // Upgrade = deploy. No other action.
    restartBackend();

    expect(tableCount()).toBe(1);
    expect(ledgerRows()).toBe(1);
  });

  test('…and the pre-existing flat bundle still resolves, while nesting now works',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // Fresh context after the restart: re-login for the admin session cookie + csrf.
      ({ csrf } = await login(request, OWNER.email, OWNER.password));

      // The old bundle + its membership survived (only bundle_includes was dropped). The code that
      // carried it before the upgrade still resolves its block — ResolveMembers reads the (now
      // re-created) bundle_includes, finds none, and falls back to the direct members.
      expect(await toolsFor(request, 'LEGACY-CODE', 'L'),
        'a code that carried a bundle before the upgrade keeps its grant').toContain(RETRIEVAL_TOOL);

      // The new capability the migration unlocks: an outer bundle includes the legacy one, and a code
      // bound to the outer resolves the union across the freshly-created table.
      const outer = await createBundle(request, 'outer', []);
      await setIncludes(request, outer, [flatBundleID]);
      await bindCode(request, 'NEST-CODE', outer);
      expect(await toolsFor(request, 'NEST-CODE', 'N'),
        'nesting resolves through the new bundle_includes table').toContain(RETRIEVAL_TOOL);

      await request.dispose();
    });
});
