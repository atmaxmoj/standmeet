// upgrade-retention-bundles.spec.ts —— old volume + new code: the deploy brings the retention clock
// (`2026-10-13-retention-bundles.sql`): retention_bundles, job_assessment_trash, and bundle_id /
// cleared_at / expired_at / revoked_reason on the existing tables.
//
// "Done" (docs/design/job-loop-retention.md §7): everything recorded before the upgrade is kept and
// is forever — no row is put on a clock; an assessment written after the upgrade can be ephemeral.
//
// Method (as upgrade-visit-event-network): rows recorded on the new code, the new tables and
// columns dropped and the migration forgotten (v0.1.155 has none of them), then exactly one action:
// restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { allHistory, jobsAnnotate } from '@/fixtures/job-ledger';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-13-retention-bundles.sql';
const count = (sql: string): number => Number(querySQL(sql));
const added = (): number => count(`SELECT count(*) FROM information_schema.columns WHERE
  (table_name = 'job_seen' AND column_name IN ('bundle_id', 'cleared_at'))
  OR (table_name = 'microsites' AND column_name IN ('bundle_id', 'expired_at'))
  OR (table_name = 'access_codes' AND column_name = 'revoked_reason')`);
const tables = (): number => count(`SELECT count(*) FROM information_schema.tables
  WHERE table_name IN ('retention_bundles', 'job_assessment_trash')`);

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'upgraderetention');
  await jobsAnnotate(o, (o.jobs[0] as { job_seen_id?: string }).job_seen_id!, { reason: 'ZEBRAOLD' });
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  await o.request.dispose();
  restartBackend();
});

test('an old volume + a deploy → the clock arrives; everything recorded stays forever', async () => {
  const ledger = count('SELECT count(*) FROM job_seen');
  expect(ledger, 'presence: postings were recorded').toBeGreaterThan(0);
  execSQL(`ALTER TABLE job_seen DROP COLUMN IF EXISTS bundle_id, DROP COLUMN IF EXISTS cleared_at;
    ALTER TABLE microsites DROP COLUMN IF EXISTS bundle_id, DROP COLUMN IF EXISTS expired_at;
    ALTER TABLE access_codes DROP COLUMN IF EXISTS revoked_reason;
    DROP TABLE IF EXISTS job_assessment_trash; DROP TABLE IF EXISTS retention_bundles;`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
  expect(added() + tables(), 'pre-state built').toBe(0);

  restartBackend();

  expect(added(), 'the columns arrived').toBe(5);
  expect(tables(), 'the tables arrived').toBe(2);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(count('SELECT count(*) FROM job_seen'), 'postings kept').toBe(ledger);
  expect(count('SELECT count(*) FROM job_seen WHERE bundle_id IS NOT NULL'), 'none on a clock').toBe(0);

  o.sid = await initMCP(o.request, o.apiToken);
  const row = (await allHistory(o)).find((r) => r.reason === 'ZEBRAOLD') as unknown as { retention: string };
  expect(row?.retention, 'an assessment from before is forever').toBe('forever');
  const second = (o.jobs[1] as { job_seen_id?: string }).job_seen_id!;
  await jobsAnnotate(o, second, { reason: 'ZEBRANEW', retention: 'ephemeral' });
  const fresh = (await allHistory(o)).find((r) => r.job_seen_id === second) as unknown as { retention: string };
  expect(fresh?.retention, 'one written after can be ephemeral').toBe('ephemeral');
});
