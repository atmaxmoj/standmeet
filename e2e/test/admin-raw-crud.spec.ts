// admin-raw-crud.spec.ts —— raw entries: DumpBox, filter, promote, archive, edit.
//
// User story:
//   1. DumpBox → pick a source chip → type → dump → a new row appears
//   2. Switch filter (unprocessed / promoted / all) → the list filters
//   3. promote → wiki modal → fill title → confirm → raw becomes "promoted"
//   4. Edit body → save → body updates

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'raw-crud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rawcrud',
  fullName: 'Raw CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin raw CRUD operations', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('DumpBox → input → dump → new entry in list',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await adminPage.waitForURL('**/admin/raw', { timeout: 5_000 });
      // Open dump box
      const dumpInput = adminPage.getByTestId('dump-input');
      await dumpInput.fill('Test raw entry from UI.');
      await adminPage.getByRole('button', { name: /dump/i }).click();
      // New row should appear
      await expect(adminPage.getByText('Test raw entry from UI.', { exact: false }))
        .toBeVisible({ timeout: 5_000 });
    });

  // F-L-16 — after deleting an entry, the list has one fewer row, but **none of the
  // four counters move**: the header's "N unprocessed", the four tabs, the sidebar
  // badge, the pulse panel — all still report the pre-delete count, and only a full
  // page reload brings them back in sync.
  // They all read the same growth resource, and that resource was never invalidated
  // after a mutation — the convergence point (`bumpCorpusEpoch` inside `run()`)
  // was already wired, but only the tree got hooked up to it; the counters never were.
  // Found manually on 2026-08-07, corpus-raw item 3: the backend deletes cleanly
  // (the row 404s, the asset is also gone from the bucket), yet the screen keeps
  // insisting everywhere that it's still there.
  test('deleting a raw entry moves the counters, not just the list (F-L-16)',
    async ({ adminPage }) => { await assertDeleteMovesCounters(adminPage); });

  // rot-E4: removed a dead "filter toggle → unprocessed vs all" test — it guarded its only assertion
  // behind `if raw-filter-all visible`, a testid that no longer exists (raw has no unprocessed/all
  // filter, only the view toggle). It was a no-op that could never fail while its name promised a
  // filter that isn't there.

  test('promote raw → wiki modal → fill title → wiki entry created',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await dumpEntry(adminPage, 'Entry to promote to wiki.');
      const row = adminPage.getByTestId(/^raw-row-/).filter({
        hasText: 'Entry to promote to wiki.',
      });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /promote/i }).click();
      // Fill wiki title in promote form (testid: raw-promote-form-{id}-title)
      const titleInput = adminPage.locator('[data-testid$="-title"]').last();
      await titleInput.fill('Promoted Wiki Entry');
      await adminPage.locator('[data-testid$="-submit"]').last().click();
      // Toast confirms promote action
      await expect(adminPage.getByText('Promoted to wiki')).toBeVisible({ timeout: 5_000 });
      // The wiki entry exists in /admin/wiki
      await gotoAdminSection(adminPage, 'wiki');
      await expect(adminPage.getByText('Promoted Wiki Entry')).toBeVisible({ timeout: 5_000 });
    });

  // A vault note body is verbatim markdown: leading YAML frontmatter + a
  // `> Parent: [[..]]` backlink line that are ALSO parsed into tags/parent_id.
  // The list preview must be CLEAN prose, not a raw dump of that markup — the
  // old render printed `{body}` verbatim (frontmatter + Parent:) into the card.
  test('body with frontmatter → list preview is clean prose, not raw markup',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      const body = [
        '---', 'tags:', '  - alpha', '---', '',
        '# Necessity Heading', '',
        '> Parent: [[stages-and-gates]]', '',
        'Stage gating is genuinely necessary here.',
      ].join('\n');
      // Can't match on the raw body — the row renders the CLEANED preview, so find
      // it by the clean sentence that survives.
      await adminPage.getByTestId('dump-input').fill(body);
      await adminPage.getByRole('button', { name: /dump/i }).click();
      const row = adminPage.getByTestId(/^raw-row-/).filter({
        hasText: 'Stage gating is genuinely necessary here.',
      });
      await expect(row).toBeVisible({ timeout: 5_000 });
      // The preview is `usecases.LeadLine` —— **the first line of real prose**: frontmatter,
      // headings, fences, `> Parent:` and wikilink-only lines are all skipped by design (F-R-1/2).
      // This case used to assert `Necessity Heading` survived; that was the older intent, and the
      // heading is structure, not prose. What this test is actually for is the next two lines:
      // the raw markup must never reach the card.
      await expect(row).not.toContainText('Parent:');
      await expect(row).not.toContainText('tags:');
      await expect(row).not.toContainText('#');
      await expect(row).not.toContainText('[[');
    });

  test('view toggle → switches tree ⇄ grid, list stays rendered',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await dumpEntry(adminPage, 'Entry so the list is non-empty.');
      await expect(adminPage.getByTestId('corpus-view-toggle')).toBeVisible();
      await adminPage.getByTestId('corpus-view-grid').click();
      await expect(adminPage.getByTestId('raw-list')).toBeVisible();
      await adminPage.getByTestId('corpus-view-tree').click();
      await expect(adminPage.getByTestId('raw-list')).toBeVisible();
    });
});

async function assertDeleteMovesCounters(page: Page): Promise<void> {
  await gotoAdminSection(page, 'raw');
  // Two entries: after deleting one, at least one remains, so the badge doesn't
  // vanish entirely just because it hit zero (that's a separate concern).
  // Wait for the **POST response**, not for the row to appear — the row is
  // optimistically inserted and shows up first, while the server may not have
  // persisted it yet; if we don't wait, the reload below would read a fake baseline
  // (the first version went falsely red exactly this way).
  for (const body of ['Raw entry one, to be deleted.', 'Raw entry two, the survivor.']) {
    await page.getByTestId('dump-input').fill(body);
    const stored = page.waitForResponse(
      (r) => r.url().includes('/api/admin/corpus/raw')
        && r.request().method() === 'POST' && r.status() < 400,
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /dump/i }).click();
    await stored;
  }
  // Do a full page reload so the baseline is **real** — otherwise subtracting from
  // an already-stale number makes neither red nor green mean anything.
  await page.reload();
  const row = page.locator('[data-testid^="raw-delete-"]').first();
  await expect(row).toBeVisible({ timeout: 5_000 });

  const header = page.getByTestId('section-header');
  await expect(header).toContainText(/[1-9]\d* unprocessed/, { timeout: 10_000 });
  const before = countIn(await header.innerText());
  expect(before, '基线必须 ≥2,否则删完 badge 归零会盖住真正要测的东西').toBeGreaterThanOrEqual(2);

  // Test the **create** path first — it bypasses useCorpusActions and goes through
  // its own doAddRaw, so after the first delete fix it still didn't move: the two
  // paths each carry their own copy of the invalidation, and the later addition only
  // landed in one of them (F-L-16).
  await page.getByTestId('dump-input').fill('One more, to watch the counter go up.');
  await page.getByRole('button', { name: /dump/i }).click();
  await expect(header, '粘一条进来,标题上的数就得涨').toContainText(`${before + 1} unprocessed`);
  await expect(
    page.getByTestId('badge-raw'),
    '侧栏 badge 也一样,不许等自己的轮询',
  ).toHaveText(String(before + 1));

  // One was just added above, so the count is now before+1; deleting one should
  // bring it back to exactly before.
  page.once('dialog', (d) => void d.accept());
  await page.locator('[data-testid^="raw-delete-"]').first().click();

  // No reload. The header count must drop the instant the delete completes.
  await expect(header, '标题上的数必须跟着列表一起动').toContainText(`${before} unprocessed`);
  // The sidebar badge reports the same fact, so it must report the same number
  // (not wait for its own 60-second poll).
  await expect(
    page.getByTestId('badge-raw'),
    '侧栏 badge 跟标题读的必须是同一份数',
  ).toHaveText(String(before));
}

// countIn — extracts the number from "raw · 12 unprocessed".
function countIn(text: string): number {
  const m = /(\d+)\s+unprocessed/.exec(text);
  if (m === null) throw new Error(`no count in header: ${text}`);
  return Number(m[1]);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function dumpEntry(page: Page, body: string): Promise<void> {
  const dumpInput = page.getByTestId('dump-input');
  await dumpInput.fill(body);
  await page.getByRole('button', { name: /dump/i }).click();
  // Scope to the row, not "any text matching body" — textarea also still
  // shows `body` during the brief window between click and async setText('')
  // clearing it, which makes a `getByText(body)` strict-mode violate.
  await expect(
    page.getByTestId(/^raw-row-/).filter({ hasText: body }),
  ).toBeVisible({ timeout: 5_000 });
}
