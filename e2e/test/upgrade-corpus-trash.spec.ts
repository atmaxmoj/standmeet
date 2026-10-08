// upgrade-corpus-trash.spec.ts —— an old volume + new code: the deploy carries the corpus trash
// (`2026-10-08-corpus-trash.sql`: the corpus_trash table, the triggers that fill it, and the
// restore function).
//
// The full suite only exercises a fresh volume (schema.sql), which proves nothing about an upgrade.
// Method (mirrors upgrade-resume-masters): on a DB with an owner and a corpus, roll back to the real
// pre-upgrade shape — drop the triggers, the functions and the table, delete this migration's
// ledger row — then do exactly one thing: restart the backend (= deploy). The migration must arrive
// through the real mechanism, never applied by the test.
//
// What the upgrade must keep: every pre-upgrade entry is still there. What it must add: deleting a
// pre-upgrade entry now lands in the trash, and restore brings it back with its child.
//
// Serial: the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-08-corpus-trash.sql';

const OWNER = {
  email: 'trash-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'trashupgrader', fullName: 'Trash Upgrader',
};

function count(sql: string): number {
  return Number(querySQL(sql));
}

let request: APIRequestContext;
let token = '';
let parent = '';
let child = '';

test.describe('upgrade · deploying the new version adds the corpus trash to a live instance', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'trash-upgrade');
    const sid = await initMCP(request, token);
    parent = (await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'wiki', title: 'Pre-upgrade Parent', body: 'p' })).id;
    child = (await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'wiki', title: 'Pre-upgrade Child', body: 'c', parent_id: parent })).id;
    await callTool(request, token, sid, 'corpus.create',
      { genre: 'raw', body: 'a pre-upgrade raw thought', source: 'mcp:e2e', tags: [] });
  });

  // Safety net: if a test dies mid-run the DB is left in the old shape; one more restart fixes it.
  test.afterAll(async () => {
    restartBackend();
    await request.dispose();
  });

  test('an old volume with a corpus + a deploy → the trash is installed, the corpus intact', () => {
    // Roll back to the pre-upgrade shape — it must actually take effect, or this is a fake,
    // permanently-green upgrade test.
    execSQL('DROP TRIGGER IF EXISTS corpus_notes_trash ON corpus_notes');
    execSQL('DROP TRIGGER IF EXISTS note_refs_trash ON note_refs');
    execSQL('DROP TRIGGER IF EXISTS writing_refs_trash ON writing_refs');
    execSQL('DROP FUNCTION IF EXISTS corpus_trash_restore(uuid, uuid)');
    execSQL('DROP FUNCTION IF EXISTS corpus_trash_row()');
    execSQL('DROP TABLE IF EXISTS corpus_trash');
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='corpus_trash'`),
      'pre-state not built: the table is still there').toBe(0);
    expect(count(`SELECT count(*) FROM pg_trigger WHERE tgname = 'corpus_notes_trash'`),
      'pre-state not built: the trigger is still there').toBe(0);
    const before = count('SELECT count(*) FROM corpus_notes');
    expect(before, 'the seeded corpus is there').toBe(3);

    // Upgrade = deploy. No other action.
    restartBackend();

    expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='corpus_trash'`)).toBe(1);
    expect(count(`SELECT count(*) FROM pg_trigger WHERE tgname = 'corpus_notes_trash'`)).toBe(1);
    expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
    expect(count('SELECT count(*) FROM corpus_notes'), 'every entry survives the upgrade').toBe(before);
    expect(count('SELECT count(*) FROM corpus_trash'), 'the upgrade itself trashes nothing').toBe(0);
  });

  test('…a pre-upgrade entry deleted now goes to the trash and restores with its child', async () => {
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'corpus.delete', { genre: 'wiki', id: parent });
    const trash = await callTool<{ items: { id: string; descendants: number }[] }>(
      request, token, sid, 'corpus.trash', {});
    expect(trash.items.map((i) => i.id)).toEqual([parent]);
    expect(trash.items[0]?.descendants).toBe(1);

    await callTool(request, token, sid, 'corpus.restore', { id: parent });
    const back = await callTool<{ parent_id?: string }>(
      request, token, sid, 'corpus.get', { genre: 'wiki', id: child });
    expect(back.parent_id, 'the child is back under its parent').toBe(parent);
  });
});
