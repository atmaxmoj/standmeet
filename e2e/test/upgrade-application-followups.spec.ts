// upgrade-application-followups.spec.ts —— old volume + new code: the deploy brings follow-ups
// (`2026-10-10-application-followups.sql`: applications.next_followup_at + followup_nudges,
// roadmap 3.1.a).
//
// "Done" (test plan): next_followup_at is backfilled from the commit time (+7 days): an application
// committed 10 days ago is due at once, one committed 3 days ago is not; the history does not set
// off a burst of reminders (one per due application, once).
//
// Method (as upgrade-application-outcomes): applications committed on the new code and backdated,
// the columns dropped and the migration ledger forgetting it (and every later migration naming
// them), then exactly one action: restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { commitApplication, setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-10-application-followups.sql';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/db/migrations');

let o: LoopOwner;
let old: Committed;
let recent: Committed;
const count = (sql: string): number => Number(querySQL(sql));

function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= MIGRATION)
    .filter((f) => f === MIGRATION || /\b(next_followup_at|followup_nudges)\b/.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')));
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'upgradefollowups');
  old = await commitApplication(o, 0);
  recent = await commitApplication(o, 1);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
  await o.request.dispose();
});

test('an old volume + a deploy → follow-ups backfilled from the commit time', async () => {
  execSQL('ALTER TABLE applications DROP COLUMN IF EXISTS next_followup_at, DROP COLUMN IF EXISTS followup_nudges');
  execSQL(`UPDATE applications SET created_at = now() - interval '10 days' WHERE id = '${old.applicationID}'`);
  execSQL(`UPDATE applications SET created_at = now() - interval '3 days' WHERE id = '${recent.applicationID}'`);
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${laterMigrations().map((f) => `'${f}'`).join(',')})`);

  restartBackend();

  // The daily task also runs as the backend boots, so "due at once" is seen as: announced, once.
  o.sid = await initMCP(o.request, o.apiToken);
  await callTool(o.request, o.apiToken, o.sid, 'tasks.run_periodic', { name: 'application followups' });
  const announced = (id: string): number =>
    count(`SELECT count(*) FROM events WHERE type = 'application.followup_due' AND subject = 'application/${id}'`);
  await expect.poll(() => announced(old.applicationID), { timeout: 30_000, message: 'ten days old: due at once' }).toBe(1);
  expect(announced(recent.applicationID), 'three days old: not yet').toBe(0);
  expect(count(`SELECT count(*) FROM applications WHERE next_followup_at > now() + interval '6 days' AND id = '${old.applicationID}'`),
    'announced once and moved a week on — the missed weeks are not a burst').toBe(1);
  const due = await callTool<{ due: unknown[] }>(o.request, o.apiToken, o.sid, 'applications.followups_due', {});
  expect(due.due, 'nothing left due').toEqual([]);
});
