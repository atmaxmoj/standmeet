// upgrade-pending-email-columns.spec.ts — an old volume + new code, **the upgrade is
// carried out by the deploy itself**.
//
// v0.0.1 has already shipped, so every schema change now has two rollout scenarios:
//   (1) a brand-new pg volume — `schema.sql` runs once and everything's correct
//   (2) **an already-running instance** — the volume already has an owner, codes,
//       corpus, and then the new version lands on top
//
// The full e2e suite has always only tested (1)
// ([[schema-lives-in-the-volume-not-the-image]]: green on an empty volume proves
// nothing about an upgrade).
//
// Warning: the first version of this spec **applied that SQL itself**
// (`applyMigration(MIGRATION)`). It went green, but all it proved was "that .sql
// file is written correctly" — because on a real instance, nobody performs that
// step manually. "How does a migration actually reach an instance", the part that
// can genuinely break, was being done by the test itself instead of the real
// mechanism. That fixture has since been deleted, so now **there is only one path
// to an upgrade**: restart the backend, i.e. deploy.
//
// Method: on a database that already has data, roll it back to the real
// "pre-upgrade" shape — drop the new columns, **and also delete that migration's row
// from the ledger** (that's exactly what an un-upgraded instance looks like: the
// ledger exists, but this row is missing from it). Then do exactly one thing:
// restart the backend.
//
// Order-sensitive: while this spec runs, the database is briefly in a broken state;
// e2e runs with workers:1 (serial) — do not switch this to parallel.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-08-31-pending-email.sql';
const NEW_COLUMNS = ['pending_email', 'pending_email_token_hash', 'pending_email_expires_at'];

const OWNER = {
  email: 'upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'upgrader',
  fullName: 'Ursula Upgrader',
};

function columnCount(): number {
  const list = NEW_COLUMNS.map((c) => `'${c}'`).join(',');
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='owners' AND column_name IN (${list})`,
  ));
}

// ledgerRows — how many rows this migration has in the ledger. **Exactly one row**
// is its own invariant: zero means never applied, two means applied twice (and one
// of the eight migration files contains an UPDATE that is not idempotent).
function ledgerRows(): number {
  return Number(querySQL(
    `SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`,
  ));
}

// downgrade — rolls the database back to the real shape of "this instance hasn't
// upgraded to this version yet".
// Both things must happen: the columns are gone, **and** the ledger row is gone too.
// Dropping only the columns would leave the ledger saying "already applied", so it
// gets skipped at startup — and then the test would only be proving the ledger
// works, not that the upgrade works.
function downgrade(): void {
  execSQL(`ALTER TABLE owners ${NEW_COLUMNS.map((c) => `DROP COLUMN IF EXISTS ${c}`).join(', ')}`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, { data: { email, password } });
  return res.status();
}

// seedInstance — "an already-running instance with data on it". This is exactly what
// the upgrade tests against.
async function seedInstance(request: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), OWNER);
  // Configure the mail connector: **the new columns are only used on the
  // pending-confirmation path**. Without it, changing the email goes through a
  // direct swap and never touches the three new columns even once — and then
  // "the new feature works" would be a claim nothing actually verified.
  await configureMailConnector(request, OWNER.email, OWNER.password);
  // Seed a writing: the replay-backfill test needs to assert "the color the owner
  // picked wasn't wiped out", and a freshly reset instance has none — that test
  // would skip itself, becoming an assertion that can never fail
  // ([[assertion-that-cannot-fail]]).
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'upgrade-seed');
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'writing_create', {
    slug: 'upgrade-hued', title: 'A writing with a chosen hue', excerpt: 'x',
    body_md: 'the owner picked this colour on purpose', tags: [], publish: true,
  });
  await request.dispose();
}

// expectEmailChangeGoesPending — after the upgrade, those three columns can really
// be written and read.
// Asserts **on the columns**, not just "the endpoint returned 200": what needs
// proving is that the new schema is actually in use.
async function expectEmailChangeGoesPending(request: APIRequestContext): Promise<void> {
  const moved = 'upgrader+moved@example.com';
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: OWNER.password, new_email: moved },
  });
  expect(res.status()).toBe(200);
  expect(querySQL(`SELECT pending_email FROM owners WHERE handle = '${OWNER.handle}'`))
    .toBe(moved);
  // Identity hasn't moved yet: before confirmation, login still uses the old email.
  expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
}

test.describe('upgrade · deploying the new version migrates an instance that already has data', () => {
  // Every test here does **one real deploy** (docker compose restart + waiting for
  // health), which alone eats up most of the default 30s. The first version didn't
  // set this, so a test got cut off by the clock right at the PATCH line — while
  // that PATCH had actually succeeded with 200 (829ms in the backend log). A
  // timeout is not proof that something didn't happen.
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    await seedInstance(await playwright.request.newContext());
  });

  // Safety net: if this test dies mid-run, the database is left in the old shape.
  // One more restart fixes it — and "restart fixes it" is exactly the shape this
  // mechanism is supposed to have.
  test.afterAll(() => {
    restartBackend();
  });

  // This test and the next one are the same upgrade's two halves: first ask "did
  // the deploy bring it up", then ask "is everything still fine". Order-dependent
  // (workers:1, serial): the next test runs on the already-upgraded instance this
  // one leaves behind.
  test('an old volume + a deploy of the new version → the deploy applies the schema', () => {
    // Before the upgrade: this instance has real data.
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`))
      .toBe(OWNER.email);

    // Roll back to the old shape. **This must actually take effect** — otherwise
    // everything below runs on the new schema anyway, and this becomes a fake
    // upgrade test that's permanently green ([[assertion-that-cannot-fail]]).
    downgrade();
    expect(columnCount(), '前置状态没造出来：列还在，这条测试证明不了任何事').toBe(0);
    expect(ledgerRows(), '账本里还留着这一条，启动时会跳过 —— 那就没在测升级').toBe(0);

    // Upgrade = deploy. No other action.
    // If this line were swapped for "the test applies the SQL itself", this spec
    // would regress to its own broken first version.
    restartBackend();

    expect(columnCount()).toBe(NEW_COLUMNS.length);
    expect(ledgerRows()).toBe(1);
  });

  test('…and after that deploy the old data, the old login and the new feature all work',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // The old data is still there, not broken by the ALTER.
      expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`))
        .toBe(OWNER.email);
      // The new columns need a safe default for **rows that already existed** — this
      // is exactly where adding a NOT NULL column actually blows up.
      expect(querySQL(
        `SELECT pending_email IS NULL AND pending_email_token_hash = '' ` +
        `FROM owners WHERE handle = '${OWNER.handle}'`,
      )).toBe('t');

      // The old feature isn't broken: an owner who existed before the upgrade can
      // still log in.
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
      // The new feature works.
      await expectEmailChangeGoesPending(request);

      await request.dispose();
    });

  // Redeploys, roll back and redeploy, an ops slip — the same version can be
  // deployed many times over. The ledger's job is to make the second deploy a
  // no-op: of the eight migrations, the UPDATE in
  // `2026-08-16-cover-hue-never-chosen.sql` is **not idempotent**, and re-running it
  // would wipe out a cover_hue the owner manually set afterward, all over again.
  test('deploying the same version again is a no-op: the ledger keeps it at one', () => {
    const emailBefore = querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`);
    const pendingBefore = querySQL(
      `SELECT pending_email FROM owners WHERE handle = '${OWNER.handle}'`,
    );

    restartBackend();
    restartBackend();

    expect(columnCount()).toBe(NEW_COLUMNS.length);
    expect(ledgerRows(), '同一条被记了不止一次 —— 说明它被重跑了').toBe(1);
    // Data untouched by the second deploy.
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`))
      .toBe(emailBefore);
    expect(querySQL(`SELECT pending_email FROM owners WHERE handle = '${OWNER.handle}'`))
      .toBe(pendingBefore);
  });

  // An instance that has **never seen this mechanism before**: the ledger table
  // doesn't exist yet, and it's genuinely missing one migration.
  //
  // This test was earned from a real-environment incident. The first version had a
  // "baseline" branch: if there's no ledger, mark all eight as already applied and
  // run none of them, on the theory that "their results are already in the
  // database". The first run on dev falsified that — that instance had no ledger
  // and was genuinely missing one migration, so that one got permanently marked as
  // applied, the columns still didn't exist, and nothing reported it. And that
  // branch is exactly the one **every old instance's first startup** takes.
  test('an instance with no ledger and a missing migration gets it applied, not assumed', () => {
    downgrade();
    execSQL('DROP TABLE IF EXISTS schema_migrations');
    expect(columnCount()).toBe(0);

    restartBackend();

    expect(columnCount(), '账本不存在时它假设了"已经打过" —— 那条 migration 被跳过了')
      .toBe(NEW_COLUMNS.length);
    expect(ledgerRows()).toBe(1);
  });

  // Replaying all eight migrations must never corrupt data. The one migration that
  // backfills data (`2026-08-16-cover-hue-never-chosen.sql`) clears out a state the
  // product itself can never produce — a cover only exists on a writing, and its
  // WHERE clause is `genre <> 'writing'`. This assertion watches that exact
  // guarantee: the day someone widens the backfill to a genre where the owner can
  // actually set a color, a redeploy becomes data loss.
  test('replaying every migration does not touch a hue the owner can actually set', () => {
    execSQL(
      `UPDATE corpus_notes SET cover_hue = 'sage' WHERE genre = 'writing'`,
    );
    const painted = Number(querySQL(
      `SELECT count(*) FROM corpus_notes WHERE genre = 'writing' AND cover_hue = 'sage'`,
    ));
    // Asserts on **non-zero**: beforeAll seeded one writing. Zero would mean the
    // preconditions were never actually set up, and then "the color is still
    // there" below would trivially always hold.
    expect(painted, '前置状态没造出来：没有上过色的 writing，这条断言不会失败').toBeGreaterThan(0);

    execSQL('DROP TABLE IF EXISTS schema_migrations');
    restartBackend();

    expect(Number(querySQL(
      `SELECT count(*) FROM corpus_notes WHERE genre = 'writing' AND cover_hue = 'sage'`,
    )), '重跑把 owner 选过的颜色抹掉了 —— 那条回填的射程被放宽了').toBe(painted);
  });
});
