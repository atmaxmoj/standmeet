// corpus-paging.spec.ts —— the corpus lists page on the server (docs/design/paging.md), like every
// other owner list.
//
// Before: corpus.list answered the newest 50 rows (200 at most) and every corpus section built on
// that one page. A tab filter, a header count, the subjectivity grid, a parent picker and the
// delete warning's "also deletes N children" all saw only those rows; the rest of the corpus was
// silently missing (F-L-24 is the delete-warning half).
//
// Seeding: rows inserted directly. 55+ entries through the create form would test the form.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'corpuspaging@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpuspaging', fullName: 'Corpus Paging Owner',
};
const FILLERS = 55; // one page is 50

const WIKI_PARENT = '11111111-1111-4111-8111-000000000001';
const WIKI_CHILD = '11111111-1111-4111-8111-000000000002';
const WIKI_OLD = '11111111-1111-4111-8111-000000000003';
const RAW_FLAGGED = '11111111-1111-4111-8111-000000000004';
const SUBJ_OLD = '11111111-1111-4111-8111-000000000005';
const WRITING_OLD = '11111111-1111-4111-8111-000000000006';

let apiToken = '';

test.describe.configure({ timeout: 120_000 });
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · corpus lists page on the server', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    apiToken = await createAPIToken(request, csrf, 'corpus-paging');
    await request.dispose();
    seedCorpus();
  });

  test('raw: a filter tab finds a match older than one page', ({ adminPage }) => rawFlagged(adminPage));
  test('wiki: the delete warning counts a child that sits on another page (F-L-24)',
    ({ adminPage }) => wikiCrossPageChild(adminPage));
  test('wiki: the parent picker reaches an entry older than one page by search',
    ({ adminPage }) => wikiParentSearch(adminPage));
  test('output: the header counts every entry, not one page', ({ adminPage }) => outputCount(adminPage));
  test('subjectivity: the grid loads past the first page', ({ adminPage }) => subjectivityGrid(adminPage));
  test('writings: the parent picker reaches a writing older than one page by search',
    ({ adminPage }) => writingParentSearch(adminPage));
  test('MCP corpus.list walks the corpus page by page', ({ request }) => mcpPages(request));
});

// seedCorpus —— per genre: FILLERS rows, newest first, plus one old row that sits past page 1.
function seedCorpus(): void {
  const filler = (genre: string, extra = '', extraVals = ''): string => `
    INSERT INTO corpus_notes (owner_id, genre, title, body${extra}, created_at)
    SELECT o.id, '${genre}', '${genre} filler ' || lpad(g::text, 2, '0'), 'filler body'${extraVals},
           now() - g * interval '1 minute'
    FROM owners o, generate_series(1, ${FILLERS}) g`;
  const one = (id: string, genre: string, title: string, age: string, extra = '', extraVals = ''): string => `
    INSERT INTO corpus_notes (id, owner_id, genre, title, body${extra}, created_at)
    SELECT '${id}', o.id, '${genre}', '${title}', 'body of ${title}'${extraVals}, now() - interval '${age}'
    FROM owners o`;
  execSQL(filler('wiki'));
  // The parent is the newest wiki entry (page 1); its child is older than every filler (page 2).
  execSQL(one(WIKI_PARENT, 'wiki', 'Cross Page Parent', '-1 hour'));
  execSQL(`${one(WIKI_CHILD, 'wiki', 'Cross Page Child', '1 day', ', parent_id', `, '${WIKI_PARENT}'`)}`);
  execSQL(one(WIKI_OLD, 'wiki', 'Picker Target Wiki', '2 days'));
  execSQL(filler('raw'));
  execSQL(one(RAW_FLAGGED, 'raw', '', '1 day', ', flagged_private', ', true'));
  execSQL(filler('output'));
  execSQL(filler('subjectivity'));
  execSQL(one(SUBJ_OLD, 'subjectivity', 'Old Subjectivity Note', '1 day'));
  execSQL(filler('writing', ', slug', `, 'filler-writing-' || g`));
  execSQL(one(WRITING_OLD, 'writing', 'Old Parent Writing', '1 day', ', slug', ", 'old-parent-writing'"));
}

async function rawFlagged(page: Page): Promise<void> {
  await gotoAdminSection(page, 'raw');
  await page.getByRole('button', { name: /flagged private/i }).click();
  await expect(page.getByTestId(`raw-row-${RAW_FLAGGED}`), 'the flagged note is 56th newest').toBeVisible();
}

async function wikiCrossPageChild(page: Page): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.getByTestId('corpus-view-grid').click();
  let asked = '';
  page.on('dialog', (d) => { asked = d.message(); void d.dismiss(); });
  await page.getByTestId(`wiki-delete-${WIKI_PARENT}`).click();
  await expect.poll(() => asked, { timeout: 5_000 }).not.toBe('');
  expect(asked, 'the child is on page 2, the warning must still count it').toMatch(/also deletes/i);
}

async function wikiParentSearch(page: Page): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.getByTestId('wiki-new-btn').click();
  const parent = page.getByTestId('wiki-create-parent');
  await expect(parent.locator(`option[value="${WIKI_OLD}"]`), 'page 1 of the picker is the newest 50')
    .toHaveCount(0);
  await page.getByTestId('wiki-create-parent-search').fill('Picker Target');
  await expect(parent.locator(`option[value="${WIKI_OLD}"]`)).toHaveCount(1);
  await parent.selectOption(WIKI_OLD);
  await expect(parent).toHaveValue(WIKI_OLD);
}

async function outputCount(page: Page): Promise<void> {
  await gotoAdminSection(page, 'output');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(String(FILLERS));
}

async function subjectivityGrid(page: Page): Promise<void> {
  await gotoAdminSection(page, 'subjectivity');
  await page.getByTestId('corpus-view-grid').click();
  const list = page.getByTestId('subjectivity-list');
  await expect(list.getByTestId(/^subjectivity-row-/).first()).toBeVisible();
  const old = page.getByTestId(`subjectivity-row-${SUBJ_OLD}`);
  await expect.poll(async () => {
    await list.hover();
    await page.mouse.wheel(0, 4000);
    return old.count();
  }, { message: 'scrolling the grid reaches the 56th newest note', timeout: 20_000 }).toBe(1);
}

async function writingParentSearch(page: Page): Promise<void> {
  await gotoAdminSection(page, 'writings');
  await page.getByRole('button', { name: /new writing/i }).click();
  const parent = page.getByTestId('writing-field-parent');
  await expect(parent.locator(`option[value="${WRITING_OLD}"]`), 'page 1 of the picker is the newest 50')
    .toHaveCount(0);
  await page.getByTestId('writing-parent-search').fill('Old Parent');
  await expect(parent.locator(`option[value="${WRITING_OLD}"]`)).toHaveCount(1);
}

interface CorpusPage { items: { id: string }[]; next_cursor?: string; total?: number }

async function mcpPages(request: APIRequestContext): Promise<void> {
  const sid = await initMCP(request, apiToken);
  const first = await callTool<CorpusPage>(request, apiToken, sid, 'corpus.list', { genre: 'wiki', limit: 20 });
  expect(first.items).toHaveLength(20);
  expect(first.total, 'fillers + parent + child + picker target').toBe(FILLERS + 3);
  expect(first.next_cursor).toBeTruthy();
  const second = await callTool<CorpusPage>(request, apiToken, sid, 'corpus.list',
    { genre: 'wiki', limit: 20, cursor: first.next_cursor });
  const seen = new Set(first.items.map((it) => it.id));
  expect(second.items.some((it) => seen.has(it.id)), 'page 2 does not repeat page 1').toBe(false);
  expect(second.items).toHaveLength(20);
}
