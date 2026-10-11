// upgrade-job-seen.spec.ts —— old volume + new code: the deploy brings the seen ledger
// (`2026-10-10-job-seen.sql`: job_seen + company_marks, roadmap 4.1.a / 4.1.e).
//
// "Done" (test plan): the tables arrive; registered sources and their fingerprints are untouched;
// removing a source does not take ledger rows with it.
//
// Method (as upgrade-application-outcomes): real sources fetched on the new code, then the DB rolled
// back to the pre-ledger shape — both tables dropped, the migration ledger forgetting this migration
// and every later one naming them — then exactly one action: restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { allHistory } from '@/fixtures/job-ledger';

const MIGRATION = '2026-10-10-job-seen.sql';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/db/migrations');

let o: LoopOwner;
const count = (sql: string): number => Number(querySQL(sql));
const tableExists = (t: string): boolean =>
  count(`SELECT count(*) FROM information_schema.tables WHERE table_name='${t}'`) === 1;

function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= MIGRATION)
    .filter((f) => f === MIGRATION
      || /\b(job_seen|company_marks)\b/.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')));
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'upgradeseen');
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
  await o.request.dispose();
});

test('an old volume + a deploy → the ledger tables arrive; sources and fingerprints are untouched', () => {
  const sources = count('SELECT count(*) FROM job_sources');
  const prints = count('SELECT count(*) FROM job_fingerprints');
  expect(prints, 'presence: the seeded fetch left fingerprints').toBeGreaterThan(0);
  execSQL('DROP TABLE IF EXISTS job_seen CASCADE');
  execSQL('DROP TABLE IF EXISTS company_marks CASCADE');
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${laterMigrations().map((f) => `'${f}'`).join(',')})`);
  expect(tableExists('job_seen'), 'pre-state built').toBe(false);

  restartBackend();

  expect(tableExists('job_seen'), 'job_seen arrived').toBe(true);
  expect(tableExists('company_marks'), 'company_marks arrived').toBe(true);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(count('SELECT count(*) FROM job_sources'), 'sources untouched').toBe(sources);
  expect(count('SELECT count(*) FROM job_fingerprints'), 'fingerprints untouched').toBe(prints);
});

test('…the ledger fills on the upgraded data, and outlives the source that filled it', async () => {
  o.sid = await initMCP(o.request, o.apiToken);
  const gh = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'betalabs GH', config: { company: 'betalabs' },
  });
  await jobsFetchNew(o.request, o.apiToken, o.sid, gh.id);
  const filled = (await allHistory(o)).length;
  expect(filled, 'presence: the fetch wrote ledger rows').toBeGreaterThanOrEqual(2);
  await callTool(o.request, o.apiToken, o.sid, 'jobs.unregister_source', { source_id: gh.id });
  expect((await allHistory(o)).length, 'removing the source keeps its rows').toBe(filled);
});
