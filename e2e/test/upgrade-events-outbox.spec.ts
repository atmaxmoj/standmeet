// upgrade-events-outbox.spec.ts — an instance born before the event bus, upgraded by a deploy
// (docs/design/event-bus-outbox-webhooks.md, *Test plan* · Upgrade).
//
// Method (mirrors upgrade-microsite-build-lease): roll the database back to the real pre-upgrade
// shape — no `events` table, no corpus_notes trigger or its functions, no River tables, and no
// ledger row for the migration — then do exactly one thing: restart the backend (= deploy).
// Everything must arrive through the real boot path: pgstore.Migrate, then River's migrator.
//
// Then the upgraded instance must work on its old data:
//   • a note that existed before the upgrade (inserted with no trigger present) is searchable —
//     the boot-time reindex job covers what the bus never saw;
//   • editing that old note flows through the bus into the index;
//   • periodic jobs now run on River and leave durable records.
//
// Serial (workers:1): the database is in its old shape mid-run.

import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { callTool } from '@/fixtures/mcp';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

const MIGRATION = '2026-09-26-events-outbox.sql';

let O: RetrievalOwner;

function tableExists(name: string): boolean {
  return querySQL(`SELECT to_regclass('public.${name}') IS NOT NULL`) === 't';
}

async function titles(term: string): Promise<string[]> {
  const s = await issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
  return searchTitles(O.request, s, term);
}

function rollBackToPreBusShape(): void {
  execSQL('DROP TRIGGER IF EXISTS corpus_notes_event_ins_del ON corpus_notes');
  execSQL('DROP TRIGGER IF EXISTS corpus_notes_event_upd ON corpus_notes');
  execSQL('DROP FUNCTION IF EXISTS corpus_notes_event()');
  execSQL('DROP FUNCTION IF EXISTS corpus_note_uri(text, uuid, text, text, uuid)');
  execSQL('DROP FUNCTION IF EXISTS corpus_path_segment(text)');
  execSQL('DROP TABLE IF EXISTS events');
  // Every object River created, read from the catalog — a hand-kept list missed a table once, and
  // the half-dropped state it left (ledger gone, one table still there) is no real old instance.
  // Single-quoted body, not $$: the statement goes through a shell, which would expand $$.
  execSQL("DO 'DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables " +
    "WHERE schemaname = ''public'' AND tablename LIKE ''river\\_%'' LOOP " +
    "EXECUTE ''DROP TABLE IF EXISTS '' || quote_ident(r.tablename) || '' CASCADE''; END LOOP; END'");
  execSQL('DROP FUNCTION IF EXISTS river_job_state_in_bitmask CASCADE');
  execSQL('DROP TYPE IF EXISTS river_job_state CASCADE');
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · an instance from before the event bus', () => {
  test.describe.configure({ mode: 'serial', timeout: 400_000 });

  let request: APIRequestContext;
  let ownerID = '';

  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'busupgrade');
    request = O.request;
    ownerID = querySQL(`SELECT id FROM owners WHERE handle = '${O.handle}'`);
  });

  test.afterAll(async () => {
    restartBackend(); // safety net: a mid-run death leaves the old shape behind
    await request.dispose();
  });

  test('a deploy brings the outbox, the trigger and River; old notes are indexed and edits flow', async () => {
    rollBackToPreBusShape();
    expect(tableExists('events'), 'pre-state not built: events still there').toBe(false);
    expect(tableExists('river_job'), 'pre-state not built: river_job still there').toBe(false);
  expect(querySQL("SELECT count(*) FROM pg_tables WHERE tablename LIKE 'river\\_%'"), 'no River table left').toBe('0');

    // Data the old instance already had: written with no trigger in place, so no event exists for it.
    execSQL(`INSERT INTO corpus_notes (owner_id, genre, title, body, published)
             VALUES ('${ownerID}', 'wiki', 'Before the bus', 'OSCARKW written by the old version', true)`);

    restartBackend(); // the deploy

    expect(tableExists('events'), 'migration applied at boot').toBe(true);
    expect(tableExists('river_job'), 'River migrated at boot').toBe(true);
    expect(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe('1');

    await expect.poll(() => titles('OSCARKW'), { timeout: 90_000, intervals: [2_000] })
      .toContain('Before the bus');

    const id = querySQL(`SELECT id FROM corpus_notes WHERE title = 'Before the bus' AND owner_id = '${ownerID}'`);
    await callTool(O.request, O.apiToken, O.sid, 'corpus.update', {
      genre: 'wiki', id, title: 'Before the bus', body: 'PAPAYAKW edited after the upgrade', tags: [],
    });
    await expect.poll(() => titles('PAPAYAKW'), { timeout: 30_000, intervals: [1_000] })
      .toContain('Before the bus');

    await expect.poll(() => Number(querySQL(
      `SELECT count(*) FROM river_job WHERE kind LIKE 'periodic:%' AND state = 'completed'`,
    )), { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0);
  });
});
