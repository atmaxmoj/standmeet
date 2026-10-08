// retrieval-index-quality.spec.ts —— the Meili index the visitor's corpus_search reads from
// (owner-accepted review items, 2026-10-08, "RAG index P0").
//
// Before:
//   1. the index stored the raw body — i18n switcher markup and pane markers included — while
//      the Postgres path searched corpus_searchable(body); a word that only lives in the switcher
//      HTML matched the note.
//   2. one body field for every language: an English query ranked a Chinese note first whenever
//      that note's title happened to carry the English word.
//   3. one document per note: a hit deep in a long note was found, but its summary was the
//      note's first lines, so the agent saw a snippet that did not contain what matched.
//   4. ACL after the limit: Search pulled the top 100 for the owner, then dropped what the code
//      may not read — 100+ out-of-scope matches starved the one in-scope note to nothing.
//   5. aliases (Obsidian `aliases:`) were not indexed: a query by an alias found nothing.
//   6. upgrade: the index changed shape, so documents written by the previous version must be
//      replaced at boot, not left to answer queries.
//
// Black box: notes go in through obsidian.import (the owner MCP), queries go through the
// visitor's corpus_search tool. Step 6 reads and writes Meili directly, the way the upgrade
// specs read and write Postgres: an old-shape document is a state no API of this version makes.

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';

import { querySQL, restartBackend } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import { search, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

const MEILI = `${process.env['COMPOSE_PROJECT_NAME'] ?? 'standmeet-dev'}-meilisearch-1`;
const MEILI_KEY = 'standmeet_dev_meili_key';
const NOISE = 120;

// meili —— one Meili HTTP call from inside its container (the port is not published).
function meili(method: string, path: string, body?: unknown): string {
  const data = body === undefined ? '' : `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`;
  return execSync(
    `docker exec ${MEILI} curl -s -o - -w '\\n%{http_code}' -X ${method} ` +
    `-H 'Authorization: Bearer ${MEILI_KEY}' ${data} http://localhost:7700${path}`,
    { encoding: 'utf-8' },
  );
}

function lines(...ls: string[]): string { return ls.join('\n'); }

function vault(): { path: string; content: string }[] {
  const files = [
    {
      path: 'wiki/clean/toggler-note.md',
      content: lines(
        'Plain prose about the togglecleankw topic.',
        '',
        '> [!i18n]',
        '> <label><input type="radio" name="tn" checked>EN</label>'
        + '<label><input type="radio" name="tn">中文</label>',
        '>',
        '> > [!lang] en',
        '> > The English face mentions togglecleankw too.',
        '>',
        '> > [!lang] zh',
        '> > 中文面也提到 togglecleankw。',
      ),
    },
    {
      path: 'wiki/lang/Flow control.md',
      content: lines('---', 'lang: en', '---',
        'Backpressure keeps a fast producer from flooding a slow consumer.'),
    },
    {
      path: 'wiki/lang/Backpressure 背压机制.md',
      content: lines('---', 'lang: zh', '---', '背压让快的生产者不会淹没慢的消费者。'),
    },
    {
      path: 'wiki/long/Handbook.md',
      content: lines(
        ...Array.from({ length: 9 }, (_, i) => lines(
          `## Section ${i + 1}: routine`,
          `Routine operations text for section ${i + 1}. `.repeat(12),
          '',
        )),
        '## Section 10: Replication lag',
        'The replica falls behind when deepsectionkw floods the write-ahead log.',
      ),
    },
    {
      path: 'wiki/alias/Cluster scheduling.md',
      content: lines('---', 'aliases:', '  - zorbalith', '---', 'How pods get placed on nodes.'),
    },
    {
      path: 'wiki/projects/In scope.md',
      content: 'The one note inside the narrow scope that mentions aclstarvekw.',
    },
  ];
  for (let i = 0; i < NOISE; i++) {
    files.push({ path: `wiki/family/aclstarvekw noise ${i}.md`, content: `aclstarvekw filler ${i}.` });
  }
  return files;
}

async function full(): Promise<VisitorSession> {
  return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'F' });
}

// pollHits —— the index is fed by a job after the write; wait until the query answers.
async function pollHits(s: VisitorSession, q: string, want: (titles: string[]) => boolean) {
  let last: Awaited<ReturnType<typeof search>> = [];
  await expect.poll(async () => {
    last = await search(O.request, s, q);
    return want(last.map((h) => h.title));
  }, { timeout: 60_000 }).toBe(true);
  return last;
}

test.describe('retrieval · the search index is clean, per language, chunked, scoped before the limit', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'ragidx');
    const res = await callTool<{ created: number }>(O.request, O.apiToken, O.sid, 'obsidian.import',
      { files: vault() });
    expect(res.created, 'the vault landed').toBeGreaterThanOrEqual(NOISE + 6);
  });
  test.afterAll(async () => { await O.request.dispose(); });

  test('1 · a word that only lives in the switcher markup does not match; snippets carry no markers',
    async () => {
      const s = await full();
      const hits = await pollHits(s, 'togglecleankw', (t) => t.length > 0);
      const summary = JSON.stringify(hits);
      expect(summary, 'no pane marker in the hit').not.toMatch(/\[!(i18n|lang)\]/);
      expect(summary, 'no switcher HTML in the hit').not.toContain('<label');
      // `radio` lives only in the switcher's <input type="radio">, `i18n` only in the block marker.
      expect(await search(O.request, s, 'radio'), 'switcher-only word: no hit').toEqual([]);
      expect(await search(O.request, s, 'i18n'), 'marker-only word: no hit').toEqual([]);
    });

  test('2 · an English query ranks the English note first; a Chinese query the Chinese one',
    async () => {
      const s = await full();
      const en = await pollHits(s, 'backpressure', (t) => t.length >= 2);
      expect(en[0]?.title, 'EN query → the EN note first').toBe('Flow-control');
      const zh = await pollHits(s, '背压', (t) => t.length >= 1);
      expect(zh[0]?.title, 'ZH query → the ZH note first').toBe('Backpressure-背压机制');
    });

  test('3 · a match deep in a long note is found, and its summary comes from that section',
    async () => {
      const s = await full();
      const hits = await pollHits(s, 'deepsectionkw', (t) => t.includes('Handbook'));
      const hit = hits.find((h) => h.title === 'Handbook');
      expect(JSON.stringify(hit), 'the summary is the matching section').toContain('deepsectionkw');
    });

  test(`4 · ${NOISE} out-of-scope matches do not starve the one in-scope note`, async () => {
    // The noise ranks above the in-scope note (the keyword is in its titles), so once everything
    // is indexed an ACL-after-limit search never returns it. Wait for the index to settle first —
    // every event fanned out, no index job pending — or the in-scope note, imported early, answers
    // before the noise lands and the test passes on the bug.
    await expect.poll(() => querySQL(
      `SELECT (SELECT count(*) FROM events WHERE fanned_out_at IS NULL AND poisoned_at IS NULL)
            + (SELECT count(*) FROM river_job WHERE kind = 'corpus.index'
                 AND state NOT IN ('completed', 'discarded', 'cancelled'))`,
    ), { timeout: 60_000, message: 'the index jobs drain' }).toBe('0');
    const narrow = await issueSession(O.request, { handle: O.handle, code: O.narrowCode, visitor_name: 'N' });
    const hits = await pollHits(narrow, 'aclstarvekw', (t) => t.includes('In-scope'));
    expect(hits.every((h) => h.path.startsWith('projects/')), 'nothing out of scope').toBe(true);
  });

  test('5 · a query by an Obsidian alias finds the note', async () => {
    const s = await full();
    const hits = await pollHits(s, 'zorbalith', (t) => t.length > 0);
    expect(hits[0]?.title).toBe('Cluster-scheduling');
  });

  test('6 · upgrade: a document in the previous index shape is replaced at boot', async ({ playwright }) => {
    const owner = querySQL('SELECT id FROM owners LIMIT 1');
    const stale = '00000000-0000-0000-0000-0000000000aa';
    // The pre-upgrade shape: one document per note, id = the note id, the raw body.
    meili('POST', '/indexes/corpus_notes/documents', [{
      id: stale, owner_id: owner, genre: 'wiki', path: 'stale', title: 'Stale',
      body: 'stalekw', parent_id: '', tags: [], published: true,
    }]);
    await expect.poll(() => meili('GET', `/indexes/corpus_notes/documents/${stale}`).trim().split('\n').pop(),
      { timeout: 15_000, message: 'pre-state not built: the old document is not in the index' }).toBe('200');

    restartBackend(); // upgrade = deploy

    await expect.poll(() => meili('GET', `/indexes/corpus_notes/documents/${stale}`).trim().split('\n').pop(),
      { timeout: 60_000, message: 'the old-shape document is gone after boot' }).toBe('404');
    // A fresh context: the shared one holds keep-alive sockets to the backend process that just
    // went away.
    const fresh = await playwright.request.newContext();
    const s = await issueSession(fresh, { handle: O.handle, code: O.fullCode, visitor_name: 'F' });
    await expect.poll(async () => (await search(fresh, s, 'deepsectionkw')).map((h) => h.title),
      { timeout: 60_000, message: 'the notes are back in the new shape' }).toContain('Handbook');
    await fresh.dispose();
  });
});
