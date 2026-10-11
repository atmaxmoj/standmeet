// upgrade-job-seen-reposts.spec.ts —— old volume + new code: the deploy brings job_seen.reposts
// (`2026-10-11-job-seen-reposts.sql`, roadmap 1.5.b).
//
// "Done": the column arrives; every ledger row is kept with its status and reads reposts 0; the
// ledger counts reposts on the upgraded data.
//
// Method (as upgrade-job-seen): ledger rows written on the new code, then the column dropped and
// the migration forgotten, then exactly one action: restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { allHistory, jobsRecord } from '@/fixtures/job-ledger';

const MIGRATION = '2026-10-11-job-seen-reposts.sql';
const JOB = { title: 'Site Reliability Engineer', company: 'Upgrade Repost Co', location: 'Remote' };

let o: LoopOwner;
const count = (sql: string): number => Number(querySQL(sql));
const columnExists = (): boolean => count(`SELECT count(*) FROM information_schema.columns
  WHERE table_name='job_seen' AND column_name='reposts'`) === 1;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'upgradereposts');
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
  await o.request.dispose();
});

test('an old volume + a deploy → reposts arrives; ledger rows are kept and read 0', async () => {
  await jobsRecord(o, [{ ...JOB, url: 'https://jobs.upgrade-repost.example/1' }]);
  const rows = count('SELECT count(*) FROM job_seen');
  const seen = count(`SELECT count(*) FROM job_seen WHERE status = 'seen'`);
  expect(rows, 'presence: the ledger has rows').toBeGreaterThan(0);
  execSQL('ALTER TABLE job_seen DROP COLUMN IF EXISTS reposts');
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
  expect(columnExists(), 'pre-state built').toBe(false);

  restartBackend();

  expect(columnExists(), 'reposts arrived').toBe(true);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(count('SELECT count(*) FROM job_seen'), 'rows kept').toBe(rows);
  expect(count(`SELECT count(*) FROM job_seen WHERE status = 'seen'`), 'statuses kept').toBe(seen);
  o.sid = await initMCP(o.request, o.apiToken);
  const ledger = await allHistory(o);
  expect(ledger.length).toBe(rows);
  expect(ledger.every((r) => r.reposts === 0), 'no repost was ever recorded before').toBe(true);
});

test('…the upgraded ledger counts a repost', async () => {
  execSQL(`UPDATE job_seen SET last_seen_at = now() - interval '20 days'
           WHERE snapshot->>'company' = '${JOB.company}'`);
  await jobsRecord(o, [{ ...JOB, url: 'https://jobs.upgrade-repost.example/2' }]);
  const row = (await allHistory(o)).find((r) => r.company === JOB.company);
  expect(row?.reposts).toBe(1);
});
