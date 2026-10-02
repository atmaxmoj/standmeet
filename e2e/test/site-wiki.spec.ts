// site-wiki.spec.ts —— SiteWiki: a microsite that reads like a wiki, stored in the microsite's own
// store (docs/design/site-wiki.md). The page's whole source is `<SiteWiki />`.
//
// Two visitors on two codes bound to one page. Black-box: what each open page shows.
//   1  an empty wiki says so and offers to write the first page
//   2  a page with a [[link]] to a page that does not exist shows the link as missing
//   3  following the missing link opens the editor there; saving makes the page, the link resolves,
//      and the new page lists the first as a backlink
//   4  a nested path shows its folder in the tree
//   5  an edit shows the new text; the history lists both versions with their authors
//   6  the other visitor's open page shows the edit without a reload
//   7  a reload on a page's address lands on that page
//   8  review on: a new version waits, and the page keeps showing the approved one

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';
import { setStorePolicy, setStoreWritable } from '@/fixtures/microsite-store';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'sitewiki@example.com', password: 'correct-horse-battery-staple',
  handle: 'sitewikiowner', fullName: 'Site Wiki Owner',
};
const SLUG = 'ledger-wiki';
const APP = `import { SiteWiki } from '@standmeet/sdk';
export default function App() { return <SiteWiki />; }`;

let admin: APIRequestContext;
let csrf = '';
let ana: Page;
let ben: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, browser }) => {
  test.setTimeout(420_000); // one microsite build + two code sessions
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(admin, OWNER.email, OWNER.password));
  await publishPage(admin, csrf, SLUG, APP);
  await setStoreWritable(admin, csrf, SLUG, true);
  for (const code of ['WIKI-A', 'WIKI-B']) {
    const c = await createCode(admin, csrf, { code, label: code });
    await bindCodeToPage(admin, csrf, c.id, SLUG);
  }
  ana = await openAs(browser, 'WIKI-A', 'Ana');
  ben = await openAs(browser, 'WIKI-B', 'Ben');
});
test.afterAll(async () => {
  await ana?.context().close();
  await ben?.context().close();
  await admin?.dispose();
});

test('1 an empty wiki says so and offers to write the first page', async () => {
  await expect(ana.getByTestId('site-wiki-empty')).toBeVisible();
  await expect(ana.getByTestId('site-wiki-new')).toBeVisible();
});

test('2 a link to a page that does not exist shows as missing', async () => {
  await ana.getByTestId('site-wiki-new').click();
  await write(ana, { path: 'ledger', title: 'The ledger', body: 'Kept by [[people/the-master]].' });
  const link = article(ana).getByRole('link', { name: 'people/the-master' });
  await expect(link).toBeVisible();
  await expect(link, 'marked missing').toHaveAttribute('data-missing', 'true');
});

test('3 following a missing link writes that page; the link resolves; a backlink appears', async () => {
  await article(ana).getByRole('link', { name: 'people/the-master' }).click();
  await expect(ana.getByTestId('site-wiki-path'), 'the editor opens at the link\'s path')
    .toHaveValue('people/the-master');
  await write(ana, { title: 'The master', body: 'He never wanted anything he wrote down.' });
  await expect(article(ana)).toContainText('He never wanted anything');
  await expect(ana.getByTestId('site-wiki-backlinks').getByRole('link', { name: 'The ledger' }))
    .toBeVisible();
  await ana.getByTestId('site-wiki-tree').getByRole('link', { name: 'The ledger' }).click();
  await expect(article(ana).getByRole('link', { name: 'people/the-master' }), 'the link resolves')
    .toHaveAttribute('data-missing', 'false');
});

test('4 a nested path shows its folder in the tree', async () => {
  const tree = ana.getByTestId('site-wiki-tree');
  await expect(tree.getByTestId('site-wiki-folder').filter({ hasText: 'people' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'The master' })).toBeVisible();
});

test('5 an edit shows the new text; the history lists both versions and their authors', async () => {
  await ana.getByTestId('site-wiki-edit').click();
  await write(ana, { body: 'Kept by [[people/the-master]], one line a day.' });
  await expect(article(ana)).toContainText('one line a day');
  await ana.getByTestId('site-wiki-history-toggle').click();
  await expect(ana.getByTestId('site-wiki-version'), 'both versions').toHaveCount(2);
  await expect(ana.getByTestId('site-wiki-version').first()).toContainText('Ana');
});

test('6 the other visitor sees the edit without a reload', async () => {
  await openFromTree(ben, 'The ledger');
  await expect(article(ben)).toContainText('one line a day', { timeout: 10_000 });
  await ana.getByTestId('site-wiki-edit').click();
  await write(ana, { body: 'Kept by [[people/the-master]], two lines a day.' });
  await expect(article(ben), 'Ben\'s open page follows').toContainText('two lines a day', { timeout: 10_000 });
});

test('7 a reload on a page\'s address lands on that page', async () => {
  await openFromTree(ben, 'The master');
  await ben.reload();
  await expect(article(ben)).toContainText('He never wanted anything', { timeout: 15_000 });
});

test('8 review on: a new version waits; the page keeps the approved one', async () => {
  await setStorePolicy(admin, csrf, SLUG, { review: true });
  await openFromTree(ana, 'The ledger');
  await ana.getByTestId('site-wiki-edit').click();
  await write(ana, { body: 'This version waits for the owner.' });
  await expect(ana.getByTestId('site-wiki-pending'), 'the writer is told it waits').toBeVisible();
  await openFromTree(ben, 'The ledger');
  await expect(article(ben)).toContainText('two lines a day');
  await expect(article(ben)).not.toContainText('waits for the owner');
  await setStorePolicy(admin, csrf, SLUG, { review: false });
});

async function openAs(browser: Browser, code: string, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await enterCodeSession(page, code, name);
  await page.waitForURL(`**/p/${SLUG}**`, { timeout: 20_000 });
  await expect(page.getByTestId('site-wiki')).toBeVisible({ timeout: 20_000 });
  return page;
}

// write —— fill whichever fields are given in the open editor, then save.
async function write(page: Page, v: { path?: string; title?: string; body?: string }): Promise<void> {
  if (v.path !== undefined) await page.getByTestId('site-wiki-path').fill(v.path);
  if (v.title !== undefined) await page.getByTestId('site-wiki-title').fill(v.title);
  if (v.body !== undefined) await page.getByTestId('site-wiki-body').fill(v.body);
  await page.getByTestId('site-wiki-save').click();
}

async function openFromTree(page: Page, title: string): Promise<void> {
  await page.getByTestId('site-wiki-tree').getByRole('link', { name: title }).click();
}

function article(page: Page) {
  return page.getByTestId('site-wiki-page');
}
