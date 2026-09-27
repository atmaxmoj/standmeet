// events-bulk-import-bound.spec.ts —— a 2,000-note vault import through the bus
// (docs/design/event-bus-outbox-webhooks.md, *Storage bounds* and P1).
//
// The import writes 2,000 corpus_notes rows; the trigger records 2,000 events; the relay fans them
// out 200 at a time. Every note must end up searchable, no job may be discarded, and the number of
// index jobs stays within a stated bound: one per note plus a small slack (in-batch coalescing of
// the same subject never creates more, only fewer).
//
// This replaces the post-import reindex goroutine (routes/admin/obsidian.go reindexAsync), which a
// restart during the rebuild lost.

import { test, expect, type Page } from '@/fixtures/test';
import { gotoAdminSection } from '@/fixtures/navigate';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

const N = 2_000;
const SLACK = 50;

let O: RetrievalOwner;

async function counts(page: Page): Promise<{ completed: number; discarded: number }> {
  await gotoAdminSection(page, 'tasks');
  await expect(page.getByTestId('tasks-count-completed')).toBeVisible();
  // The overview follows the kind filter, so periodic runs during the import do not count.
  await page.getByTestId('tasks-filter-kind').selectOption('corpus.index');
  const read = async (s: string): Promise<number> => Number(await page.getByTestId(`tasks-count-${s}`).innerText());
  return { completed: await read('completed'), discarded: await read('discarded') };
}

test.use({ ownerCredentials: { email: 'bulkbus@example.com', password: 'correct-horse-battery-staple' } });
test.describe('P1 · bulk import through the bus', () => {
  test.beforeAll(async ({ playwright }) => { O = await setupRetrievalOwner(playwright, 'bulkbus'); });
  test.afterAll(async () => { await O.request.dispose(); });

  test(`${N} imported notes are all searchable, with at most ${N}+${SLACK} index jobs and none discarded`, async ({ adminPage }) => {
    test.setTimeout(600_000);
    const before = await counts(adminPage);
    const files = Array.from({ length: N }, (_, i) => ({
      rel: `wiki/bulk/bulk-${i}.md`,
      body: makeVaultMD({ publish: true }, `BULK${i}KW note number ${i}`),
    }));
    await uploadVault(O.request, { email: O.email, password: O.password }, files);

    const s = await issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
    for (const i of [0, 1, 777, 1_500, N - 1]) {
      await expect.poll(() => searchTitles(O.request, s, `BULK${i}KW`), {
        timeout: 300_000, intervals: [2_000],
      }).toContain(`bulk-${i}`);
    }
    await expect.poll(async () => (await counts(adminPage)).completed - before.completed, {
      timeout: 300_000, intervals: [3_000],
    }).toBeGreaterThanOrEqual(N);
    const after = await counts(adminPage);
    expect(after.completed - before.completed, 'index jobs stay within the bound').toBeLessThanOrEqual(N + SLACK);
    expect(after.discarded - before.discarded, 'no job was discarded').toBe(0);
  });
});
