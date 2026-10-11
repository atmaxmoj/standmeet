// upgrade-application-answers.spec.ts —— old volume + new code: the deploy brings stored form
// answers (`2026-10-10-application-answers.sql`: application_answers, roadmap 5.4.b).
//
// "Done" (test plan): the table arrives; existing applications are untouched; an answer saved on an
// application committed before the upgrade is offered afterwards.
//
// Method (as upgrade-application-outcomes): an application committed on the new code, the table
// dropped and the migration ledger forgetting it (and every later migration naming it), then
// exactly one action: restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { commitApplication, setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-10-application-answers.sql';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/db/migrations');

let o: LoopOwner;
let app: Committed;
const count = (sql: string): number => Number(querySQL(sql));

function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= MIGRATION)
    .filter((f) => f === MIGRATION || /\bapplication_answers\b/.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')));
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'upgradeanswers');
  app = await commitApplication(o, 0);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
  await o.request.dispose();
});

test('an old volume + a deploy → answers can be kept on an application made before it', async () => {
  const apps = count('SELECT count(*) FROM applications');
  execSQL('DROP TABLE IF EXISTS application_answers CASCADE');
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${laterMigrations().map((f) => `'${f}'`).join(',')})`);
  expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='application_answers'`), 'pre-state').toBe(0);

  restartBackend();

  expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='application_answers'`)).toBe(1);
  expect(count('SELECT count(*) FROM applications'), 'applications untouched').toBe(apps);
  o.sid = await initMCP(o.request, o.apiToken);
  await callTool(o.request, o.apiToken, o.sid, 'applications.save_answers', {
    application_id: app.applicationID, answers: [{ question: 'Why us?', answer: 'Because.' }],
  });
  expect(count(`SELECT count(*) FROM application_answers WHERE application_id = '${app.applicationID}'`)).toBe(1);
});
