// events-index-via-bus.spec.ts —— Phase 1 acceptance of docs/design/event-bus-outbox-webhooks.md:
// the search index follows the corpus through the event bus, not through hook calls at call sites.
//
// Before the bus, indexing was a hand-written hook at 9 call sites. A write path that forgot it
// (CreateWiki) left the entry unfindable; a Meili outage set a process-local `dirty` flag that a
// restart erased, so notes written during the outage stayed unfindable for good. Now a database
// trigger records every corpus_notes change in the outbox, and a durable `corpus.index` job carries
// it to Meili, retried until Meili answers — across restarts.
//
// Contracts defined here (red on the unchanged code):
//   • corpus.create / corpus.update return `indexed: true` once the index has the write (the request
//     waits up to 2 s for the index job), or `indexed: false` + `index_job_id` when it has not.
//   • A write made while Meili is down becomes searchable after Meili returns — even when the backend
//     restarted in between.

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import { callTool } from '@/fixtures/mcp';
import { searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { restartBackend } from '@/fixtures/instance';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

interface WriteReceipt { id: string; indexed?: boolean; index_job_id?: number }

async function fullSess(): Promise<VisitorSession> {
  return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
}

async function createWiki(title: string, body: string): Promise<WriteReceipt> {
  return callTool<WriteReceipt>(O.request, O.apiToken, O.sid, 'corpus.create', {
    genre: 'wiki', title, body, tags: [],
  });
}

// eventuallySearchable —— polls the visitor's corpus_search until the title shows up. The bound is
// the point of the assertion, so it is stated, not left to a default.
async function eventuallySearchable(term: string, title: string, withinMs: number): Promise<void> {
  await expect.poll(async () => searchTitles(O.request, await fullSess(), term), {
    timeout: withinMs, intervals: [500],
  }).toContain(title);
}

function stopMeili(): void {
  execSync('make -C .. dev-stop-svc SVC=meilisearch', { stdio: 'inherit' });
}

function startMeili(): void {
  execSync('make -C .. dev-restart-svc SVC=meilisearch', { stdio: 'inherit' });
}

test.describe('P1 · the index follows the corpus through the bus', () => {
  test.beforeAll(async ({ playwright }) => { O = await setupRetrievalOwner(playwright, 'busindex'); });
  test.afterAll(async () => {
    startMeili();
    await O.request.dispose();
  });

  test('a wiki entry created directly through MCP corpus.create is searchable at once', async () => {
    const r = await createWiki('Bus direct create', 'PAPAKW created straight into wiki');
    expect(r.indexed, 'the receipt says the index has it').toBe(true);
    expect(await searchTitles(O.request, await fullSess(), 'PAPAKW')).toContain('Bus direct create');
  });

  test('an update is searchable at once, and the receipt says so', async () => {
    const { id } = await createWiki('Bus update', 'QUEBECKW first body');
    const r = await callTool<WriteReceipt>(O.request, O.apiToken, O.sid, 'corpus.update', {
      genre: 'wiki', id, title: 'Bus update', body: 'ROMEOKW second body', tags: [],
    });
    expect(r.indexed, 'the update receipt says the index has it').toBe(true);
    const titles = await searchTitles(O.request, await fullSess(), 'ROMEOKW');
    expect(titles).toContain('Bus update');
  });

  test('a write during a Meili outage returns a receipt, and is indexed once Meili is back', async () => {
    test.setTimeout(180_000);
    stopMeili();
    const r = await createWiki('Bus outage', 'SIERRAKW written while search was down');
    expect(r.id, 'the write itself succeeded').toBeTruthy();
    expect(r.indexed, 'the receipt does not claim the index has it').toBe(false);
    expect(r.index_job_id, 'the receipt carries the index job id').toBeGreaterThan(0);
    startMeili();
    await eventuallySearchable('SIERRAKW', 'Bus outage', 60_000);
  });

  test('a write during a Meili outage survives a backend restart before Meili returns', async () => {
    test.setTimeout(240_000);
    stopMeili();
    const r = await createWiki('Bus restart', 'TANGOKW written, then the backend restarted');
    expect(r.id).toBeTruthy();
    restartBackend();
    startMeili();
    await eventuallySearchable('TANGOKW', 'Bus restart', 90_000);
  });

  test('a delete removes the entry from search at once', async () => {
    const { id } = await createWiki('Bus delete', 'UNIFORMKW soon gone');
    await callTool(O.request, O.apiToken, O.sid, 'corpus.delete', { genre: 'wiki', id });
    // Positive form: a sentinel written after the delete is found, and the deleted one is not in
    // the same result set — so an empty or broken search cannot pass this.
    await createWiki('Bus delete sentinel', 'UNIFORMKW sentinel');
    const titles = await searchTitles(O.request, await fullSess(), 'UNIFORMKW');
    expect(titles).toEqual(['Bus delete sentinel']);
  });
});
