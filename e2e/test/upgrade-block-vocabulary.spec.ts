// upgrade-block-vocabulary.spec.ts —— old volume + new code: deploying renames the five tables
// that spelled the two dead plugin axes, and **every row survives the rename**.
//
// `2026-09-11-block-vocabulary.sql` renames owner_connectors → block_connections (connector_id →
// block_id, category → seam), capability_settings → block_enabled, and the three ACL tables, plus
// rewrites the per-block config `collection` values from `capconfig*` to `blockconfig*`.
//
// **An empty-volume green proves none of it** ([[schema-lives-in-the-volume-not-the-image]]): a
// fresh volume builds straight from schema.sql, which already has the new names, so the migration
// is a no-op and the whole upgrade path goes untested. Every other schema change in this repo has
// an `upgrade-*.spec.ts` for exactly this reason; this one shipped without one.
//
// Path under test = ② an already-running instance with real rows, rolled back to its pre-upgrade
// shape, then exactly ONE action — restart the backend (= deploy; pgstore.Migrate runs on startup).
// Not applied by hand: that would exercise a path prod never takes.
//
// What makes this worth a test rather than a read-through: a rename that loses rows still leaves a
// schema that looks right. So the rows are seeded **through the product** first, their values are
// captured, and the assertions are that those same values are readable under the new names
// afterwards — not merely that the columns exist.
//
// Order-sensitive: the DB is deliberately broken between downgrade and restart; e2e runs workers:1
// serially — do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { setBlockEnabled } from '@/fixtures/blocks';
import { setCodeBlockDenial } from '@/fixtures/code-denials';
import { MOCK_GCAL_CREDS, saveGCalCredentials, setBookingPolicy } from '@/fixtures/gcal';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const MIGRATION = '2026-09-11-block-vocabulary.sql';
const INDEX = 'block_connections_owner_block_uniq';
const DENIED_BLOCK = 'summarize_conversation';
const DISABLED_BLOCK = 'corpus.retrieval';
const SUPPLIER = 'google-calendar';
// A value no default would produce, so reading it back proves the row is the owner's and not a
// re-seeded default ([[assertion-that-cannot-fail]]).
const BUFFER_MIN = 37;

const OWNER = {
  email: 'vocabupgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'vocabupgrade', fullName: 'Vocabulary Upgrade Owner',
};

function count(sql: string): number { return Number(querySQL(sql)); }

function tableExists(name: string): boolean {
  return querySQL(
    `SELECT count(*) FROM information_schema.tables ` +
    `WHERE table_schema = 'public' AND table_name = '${name}'`,
  ) === '1';
}

function columnExists(table: string, column: string): boolean {
  return querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name = '${table}' AND column_name = '${column}'`,
  ) === '1';
}

function indexIsUnique(): boolean {
  return querySQL(
    `SELECT indisunique FROM pg_index WHERE indexrelid = 'public.${INDEX}'::regclass`,
  ) === 't';
}

function ledgerRows(): number {
  return count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

// BOOKER_SCHEMA —— the booker block's own isolated storage. Block config is not a row in a core
// table: it lives here, tagged by a `collection` name, and the migration rewrites that name with
// string arithmetic rather than moving anything.
const BOOKER_SCHEMA = 'mcp_calendar_book';

// configCollections —— the distinct collection names in the booker's store, as one sorted string.
// Compared before and after, this catches both halves of a bad rewrite: a name that did not get
// rewritten, and a name that got rewritten to the wrong thing.
function configCollections(): string {
  return querySQL(
    `SELECT string_agg(DISTINCT collection, ',' ORDER BY collection) ` +
    `FROM ${BOOKER_SCHEMA}.records`,
  );
}

function bookerBufferMin(): string {
  return querySQL(
    `SELECT doc->>'buffer_min' FROM ${BOOKER_SCHEMA}.records ` +
    `WHERE doc->>'buffer_min' IS NOT NULL LIMIT 1`,
  );
}

// RENAMES —— the five tables and their renamed column, in one list. Both directions are generated
// from it, so the downgrade cannot drift from the restore.
//
// It is written out here rather than parsed from the migration on purpose: a downgrade derived
// from the migration would inherit the migration's own bugs — if the migration forgot `category`,
// a derived downgrade would forget it too, and the pair would agree while both were wrong.
const RENAMES: { now: string; was: string; col?: [string, string] }[] = [
  { now: 'block_connections', was: 'owner_connectors', col: ['block_id', 'connector_id'] },
  { now: 'block_enabled', was: 'capability_settings', col: ['block_id', 'capability_id'] },
  { now: 'code_block_denials', was: 'code_capability_denials', col: ['block_id', 'capability_id'] },
  { now: 'api_key_block_denials', was: 'api_key_capability_denials', col: ['block_id', 'capability_id'] },
  { now: 'api_open_blocks', was: 'api_open_capabilities', col: ['block_id', 'capability_id'] },
];

// Every step is conditional on what is actually there. The first version was not, and REPEAT=3
// found it: one pass left the DB downgraded when `restartBackend` failed, and the next pass died
// on `RENAME COLUMN seam` against a table that no longer had a `seam`. A spec that renames tables
// **must** be safe to start from either shape, or one bad run poisons every spec after it.
function renameTable(from: string, to: string): void {
  execSQL(`ALTER TABLE IF EXISTS ${from} RENAME TO ${to}`);
}
// Postgres has no `RENAME COLUMN IF EXISTS`, so the condition is checked first and the rename is
// issued only when it applies. Deliberately NOT a `DO $$ … $$` block: execSQL hands the statement
// to `docker exec … psql -c "…"` through a shell, and `$$` there is the **shell's PID** — the
// first version of this helper reached psql as `DO 4711 BEGIN …` and failed on every call.
function renameColumn(table: string, from: string, to: string): void {
  const present = querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name = '${table}' AND column_name = '${from}'`,
  );
  if (present === '1') execSQL(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
}

// downgrade —— the real shape of "this instance has not upgraded yet": the five tables under their
// old names, the renamed columns back, the index back, and the ledger row gone so startup actually
// re-runs the migration.
function downgrade(): void {
  for (const r of RENAMES) {
    if (r.col) renameColumn(r.now, r.col[0], r.col[1]);
    renameTable(r.now, r.was);
  }
  renameColumn('owner_connectors', 'seam', 'category');
  execSQL(`ALTER INDEX IF EXISTS ${INDEX} RENAME TO owner_connectors_owner_connector_uniq`);
  // 'blockconfig' is 11 chars, 'capconfig' is 9: take everything from 'config' onward and put the
  // old prefix back. The migration's forward step is the mirror ('block' || substring from 4).
  execSQL(
    `UPDATE ${BOOKER_SCHEMA}.records SET collection = 'cap' || substring(collection from 6) ` +
    `WHERE collection LIKE 'blockconfig%'`,
  );
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

// restoreForward —— put the schema back in today's shape no matter where this test left it.
//
// Without this, a failed `restartBackend` leaves an instance whose five core tables carry names no
// running code knows, and every later spec fails for a reason that has nothing to do with it. The
// migration would fix it on the next successful boot, but "would, on the next boot" is not a
// guarantee this spec is allowed to hand the rest of the suite.
function restoreForward(): void {
  for (const r of RENAMES) {
    renameTable(r.was, r.now);
    if (r.col) renameColumn(r.now, r.col[1], r.col[0]);
  }
  renameColumn('block_connections', 'category', 'seam');
  execSQL(`ALTER INDEX IF EXISTS owner_connectors_owner_connector_uniq RENAME TO ${INDEX}`);
  execSQL(
    `UPDATE ${BOOKER_SCHEMA}.records SET collection = 'block' || substring(collection from 4) ` +
    `WHERE collection LIKE 'capconfig%'`,
  );
}

// downgradeAndProveItTook —— roll back to the pre-migration shape, then check the rollback
// actually happened. Without the second half the rest of the test measures nothing: a downgrade
// that silently did nothing leaves a database already in the new shape, and every assertion after
// the "upgrade" passes without the migration having run ([[assertion-that-cannot-fail]]).
function downgradeAndProveItTook(): void {
  downgrade();
  expect(tableExists('owner_connectors'), 'downgrade restored the old table name').toBe(true);
  expect(tableExists('block_connections'), 'and the new name is gone').toBe(false);
  expect(columnExists('capability_settings', 'capability_id'),
    'downgrade restored the old column name').toBe(true);
  expect(configCollections(), 'downgrade put the collection names back to capconfig*')
    .toContain('capconfig');
  expect(ledgerRows(), 'ledger row gone → startup will re-run the migration').toBe(0);
}

// expectNewNames —— the five tables and both renamed columns on block_connections. `seam` is the
// one a reader would forget: the table rename alone leaves the row shape looking plausible.
function expectNewNames(): void {
  for (const t of ['block_connections', 'block_enabled', 'code_block_denials',
    'api_key_block_denials', 'api_open_blocks']) {
    expect(tableExists(t), `${t} exists after the deploy`).toBe(true);
  }
  expect(ledgerRows(), 'the migration recorded itself once').toBe(1);
  expect(columnExists('block_connections', 'block_id'), 'connector_id → block_id').toBe(true);
  expect(columnExists('block_connections', 'seam'), 'category → seam').toBe(true);
  expect(columnExists('block_connections', 'category'), 'the old column name is gone').toBe(false);
}

test.describe('upgrade · deploying renames the block tables and loses no row', () => {
  test.describe.configure({ timeout: 300_000 });
  let codeID = '';

  test.beforeAll(async ({ playwright }) => {
    // `describe.configure({ timeout })` sets the TEST timeout; a hook keeps the default 30s, and
    // this hook does a lot (reset, claim, login, role, code, four owner writes). On a backend that
    // has just been rebuilt it ran past 30s and the spec failed for a reason that was not about
    // the migration at all.
    test.setTimeout(300_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'vocab-role', description: 'wiki', corpus_uris: ['wiki://**'],
    });
    const code = await createCode(request, csrf, {
      code: 'VOCAB-UP-1', label: 'vocab', assumed_role_id: role.id,
    });
    codeID = code.id;
    // Rows in four of the five places the migration touches, every one written by the owner doing
    // an ordinary thing — turning a block off, denying one to a code, saving a supplier's
    // credentials, setting a block's config. Seeding through the product rather than by INSERT is
    // what makes "the row survived" mean the product's row, in the product's shape.
    await setBlockEnabled(request, csrf, DISABLED_BLOCK, false);
    await setCodeBlockDenial(request, csrf, codeID, DENIED_BLOCK);
    // block_connections is the table with the most to lose: it holds encrypted credentials, a
    // token, granted scopes and the seam, and it is the only one the migration renames TWO
    // columns on. A count-only assertion here would miss a rename that kept the rows and dropped
    // what is in them.
    await saveGCalCredentials(request, csrf, MOCK_GCAL_CREDS);
    // …and a block config value, which is not a row in a core table at all: blockconfig writes it
    // into the block's OWN schema, tagged with a `collection` name the migration rewrites with
    // string arithmetic. That is the one step that can mangle rather than move.
    await setBookingPolicy(request, csrf, { buffer_min: BUFFER_MIN });
    await request.dispose();
  });

  // Repair first, restart second. If the body failed anywhere between downgrade and the deploy,
  // the schema is in the old shape and the backend cannot serve; putting the names back before
  // restarting is what keeps this spec's failure local to this spec.
  test.afterAll(() => { restoreForward(); restartBackend(); });

  test('an old volume + a deploy → the five tables carry the new names, and every row is still there',
    async () => {
      // The rows the owner just made, read under TODAY's names.
      const enabledBefore = count(
        `SELECT count(*) FROM block_enabled WHERE block_id = '${DISABLED_BLOCK}'`);
      const denialsBefore = count(
        `SELECT count(*) FROM code_block_denials WHERE block_id = '${DENIED_BLOCK}'`);
      const supplierSeamBefore = querySQL(
        `SELECT seam FROM block_connections WHERE block_id = '${SUPPLIER}'`);
      const credLenBefore = querySQL(
        `SELECT length(credentials_enc) FROM block_connections WHERE block_id = '${SUPPLIER}'`);
      const configCollectionsBefore = configCollections();
      expect(enabledBefore, 'the owner disabled a block → a block_enabled row exists').toBe(1);
      expect(denialsBefore, 'the owner denied a block to a code → a denial row exists').toBe(1);
      expect(supplierSeamBefore, 'the owner saved supplier credentials → a connection row exists')
        .not.toBe('');
      expect(bookerBufferMin(), 'the owner set a block config value').toBe(String(BUFFER_MIN));

      downgradeAndProveItTook();

      // Upgrade = deploy. No other action.
      restartBackend();

      expectNewNames();
      expect(indexIsUnique(), `${INDEX} is present and really UNIQUE`).toBe(true);

      // …and the column rename reached the other four.
      for (const t of ['block_enabled', 'code_block_denials', 'api_key_block_denials',
        'api_open_blocks']) {
        expect(columnExists(t, 'block_id'), `${t}.capability_id → block_id`).toBe(true);
      }

      // The point of the whole test: the owner's rows are still readable, under the new names,
      // with **the same values**. A rename that dropped them would satisfy every check above.
      expect(count(`SELECT count(*) FROM block_enabled WHERE block_id = '${DISABLED_BLOCK}'`),
        'the disabled-block row survived the rename').toBe(enabledBefore);
      expect(count(`SELECT count(*) FROM code_block_denials WHERE block_id = '${DENIED_BLOCK}'`),
        'the code denial row survived the rename').toBe(denialsBefore);
      expect(querySQL(
        `SELECT enabled FROM block_enabled WHERE block_id = '${DISABLED_BLOCK}'`),
      'and it still says what the owner set').toBe('f');

      // block_connections carried real payload across a table rename AND two column renames.
      // Counting rows would not notice a rename that kept the row and lost what is in it, so the
      // credential bytes, the seam and the id are all read back by value.
      expect(querySQL(
        `SELECT seam FROM block_connections WHERE block_id = '${SUPPLIER}'`),
      'the seam value rode through category → seam').toBe(supplierSeamBefore);
      expect(querySQL(
        `SELECT length(credentials_enc) FROM block_connections WHERE block_id = '${SUPPLIER}'`),
      'the encrypted credentials are the same bytes, not a re-initialised empty').
        toBe(credLenBefore);
      expect(Number(credLenBefore), 'and there were credentials to lose in the first place')
        .toBeGreaterThan(0);

      // The collection rewrite is the only step that edits a VALUE rather than moving a name:
      // `'block' || substring(collection from 4)`. Off-by-one there would silently produce
      // `blocknfig` and the owner's setting would be unreadable while every table looked fine.
      expect(configCollections(), 'capconfig* rewritten to exactly blockconfig*')
        .toBe(configCollectionsBefore);
      expect(configCollectionsBefore, 'there was a config row to rewrite').not.toBe('');
      expect(bookerBufferMin(), 'the owner’s booking policy value is still readable')
        .toBe(String(BUFFER_MIN));
    });
});
