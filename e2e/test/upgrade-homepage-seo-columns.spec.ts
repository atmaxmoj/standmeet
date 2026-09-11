// upgrade-homepage-seo-columns.spec.ts — an old volume + new code: the deploy itself carries the
// homepage-SEO migration (`2026-09-11-homepage-seo.sql`, three columns on `owners`).
//
// v0.0.1 has shipped, so this schema change has two rollouts: a fresh pg volume (schema.sql runs
// once) and an already-running instance (the new version lands on top). The full suite only ever
// exercises the fresh volume ([[schema-lives-in-the-volume-not-the-image]]: green on an empty volume
// proves nothing about an upgrade). This asserts the second.
//
// Method (mirrors upgrade-pending-email-columns): on a DB that already has an owner, roll back to the
// real pre-upgrade shape — drop the three columns AND delete this migration's ledger row (an
// un-upgraded instance's ledger exists but is missing this row) — then do exactly one thing: restart
// the backend. The migration must reach the instance through the real mechanism, never applied by the
// test itself.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-09-11-homepage-seo.sql';
const NEW_COLUMNS = ['homepage_seo_title', 'homepage_seo_description', 'homepage_seo_image'];

const OWNER = {
  email: 'homeseo-upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'homeseoupgrader',
  fullName: 'Ophelia Upgrader',
};
const SEO_TITLE = 'Site root, after the upgrade';

function columnCount(): number {
  const list = NEW_COLUMNS.map((c) => `'${c}'`).join(',');
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='owners' AND column_name IN (${list})`,
  ));
}

function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}

// downgrade — the real shape of "this instance hasn't upgraded yet": the columns are gone AND the
// ledger row is gone (dropping only the columns would leave the ledger saying "already applied", so
// startup would skip it — then the test would only prove the ledger works, not the upgrade).
function downgrade(): void {
  execSQL(`ALTER TABLE owners ${NEW_COLUMNS.map((c) => `DROP COLUMN IF EXISTS ${c}`).join(', ')}`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

// setHomepageSEOTitle — the new feature's write path (set_seo for the reserved home slug → the owner
// store). Asserts on the COLUMN, so what's proven is the new schema is actually in use.
async function setHomepageSEOTitle(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: the homepage SEO write on the upgraded schema
  const res = await request.put(`${BACKEND}/api/admin/microsites/home/seo`, {
    headers: { 'X-Csrftoken': csrf },
    data: { seo_title: SEO_TITLE, seo_description: '', seo_image: '' },
  });
  expect(res.status(), 'the homepage SEO write succeeds on the upgraded schema').toBe(200);
}

test.describe('upgrade · deploying the new version adds the homepage-SEO columns to a live instance', () => {
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

    expect(columnCount()).toBe(NEW_COLUMNS.length);
    expect(ledgerRows()).toBe(1);
  });

  test('…and after the deploy the old owner is intact, the columns default empty, and the write works',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // The old data survived the ALTER.
      expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`)).toBe(OWNER.email);
      // Rows that already existed get the safe default (empty, not NULL) — where adding a NOT NULL
      // column actually blows up.
      expect(querySQL(
        `SELECT homepage_seo_title = '' AND homepage_seo_description = '' AND homepage_seo_image = '' ` +
        `FROM owners WHERE handle = '${OWNER.handle}'`,
      )).toBe('t');

      // The new feature writes + reads the new columns on the upgraded schema.
      await setHomepageSEOTitle(request);
      expect(querySQL(`SELECT homepage_seo_title FROM owners WHERE handle = '${OWNER.handle}'`))
        .toBe(SEO_TITLE);

      await request.dispose();
    });
});
