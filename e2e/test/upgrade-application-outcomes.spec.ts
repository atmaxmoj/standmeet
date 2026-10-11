// upgrade-application-outcomes.spec.ts —— old volume + new code: the deploy brings E1's schema
// (`2026-10-10-application-outcomes.sql`): applications.engaged_at + applications.outcome + the
// application_outcomes journal, and moves a withdrawn application from the status axis to the
// outcome axis (roadmap 1.3.c).
//
// Method (as upgrade-application-code-unique): real applications committed on the new code, then the
// DB is rolled back to the pre-E1 shape — E1's columns and table dropped, one application set to the
// old status='withdrawn', the ledger forgetting this migration AND every later one whose text names
// these tables (a later one left "applied" would never run again against the table it changes) —
// then exactly one action: restart the backend (= deploy).
//
// Serial: the DB is briefly in the old shape mid-run.

import { test, expect } from '@/fixtures/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  applicationDetail, applicationRow, commitApplication, setupLoopOwner, updateOutcome,
  type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-10-application-outcomes.sql';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/db/migrations');

let o: LoopOwner;
let kept: Committed;
let withdrawn: Committed;
let before = 0;

const count = (sql: string): number => Number(querySQL(sql));

// laterMigrations —— this migration and every later one that touches the same tables.
function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= MIGRATION)
    .filter((f) => f === MIGRATION
      || /\b(applications|application_outcomes)\b/.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')));
}

function columnExists(table: string, column: string): boolean {
  return count(`SELECT count(*) FROM information_schema.columns WHERE table_name='${table}' AND column_name='${column}'`) === 1;
}

// downgrade —— the pre-E1 shape: no outcome columns, no journal, a withdraw recorded the old way.
function downgrade(): void {
  execSQL('DROP TABLE IF EXISTS application_outcomes CASCADE');
  execSQL('ALTER TABLE applications DROP COLUMN IF EXISTS engaged_at, DROP COLUMN IF EXISTS outcome');
  execSQL(`UPDATE applications SET status = 'withdrawn' WHERE id = '${withdrawn.applicationID}'`);
  const forget = laterMigrations().map((f) => `'${f}'`).join(',');
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${forget})`);
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'upgradeoutcomes');
  kept = await commitApplication(o, 0);
  withdrawn = await commitApplication(o, 1);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
  await o.request.dispose();
});

test('an old volume + a deploy → the outcome schema arrives and a withdraw moves to the outcome axis', () => {
  before = count('SELECT count(*) FROM applications');
  expect(before, 'seeded two applications').toBe(2);
  downgrade();
  expect(columnExists('applications', 'outcome'), 'pre-state not built: outcome still there').toBe(false);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`), 'ledger forgot it').toBe(0);

  restartBackend();

  expect(columnExists('applications', 'outcome'), 'outcome column arrived').toBe(true);
  expect(columnExists('applications', 'engaged_at'), 'engaged_at column arrived').toBe(true);
  expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='application_outcomes'`)).toBe(1);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(count('SELECT count(*) FROM applications'), 'no application lost').toBe(before);
  expect(querySQL(`SELECT outcome || '/' || status FROM applications WHERE id = '${withdrawn.applicationID}'`),
    'the old withdraw is an outcome now; its status is back to submitted').toBe('withdrawn/submitted');
  expect(querySQL(`SELECT outcome FROM applications WHERE id = '${kept.applicationID}'`), 'others: no outcome').toBe('none');
});

test('…and the outcome use case works on the upgraded data', async () => {
  o.sid = await initMCP(o.request, o.apiToken);
  await updateOutcome(o, kept.applicationID, 'interview', 'after the upgrade');
  expect((await applicationRow(o, kept.applicationID)).outcome).toBe('interview');
  const detail = await applicationDetail(o, kept.applicationID);
  expect(detail.outcomes.map((r) => r.to_outcome)).toEqual(['interview']);
});
