// wiki-delete-warns-about-its-children -- deleting an entry that has descendants, the
// warning must clearly say what will be deleted along with it.
//
// **This test covers the half where "both parent and child are already in the current
// list", and it is green today.**
// It was written because `▾ 0` was seen in prod on a row that genuinely has child nodes
// (F-L-24); at the time I guessed `descendantCounts(shown)` can never count children on a
// lazily-loaded tree -- **that guess was wrong**: in a small list both parent and child are
// in `shown`, so the count is accurate, which is why this test can't go red in e2e.
//
// The real trigger condition is **pagination**: prod has 574 wiki entries, `shown` only
// holds the current page, and a child on another page can't be counted. To make this fail
// red, enough cross-page entries need to be seeded first -- that test hasn't been written
// yet. **Until it is, that 0 does not get touched in code** (can't prove red, can't fix; see
// iron rule 3).
//
// Why keep this test: it locks in the "already-loaded half" behavior, and writing down
// "what it doesn't cover" here keeps the next person from mistaking this green for
// insurance covering the whole bug (see [[verifier-can-lie-about-its-own-coverage]]).

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'wikidel-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wikidelowner',
  fullName: 'Wiki Del Owner',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('deleting a wiki entry says what goes with it', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('a parent with a child warns about the cascade (F-L-24)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await createEntry(adminPage, 'Cascade Parent', '');
      const parentID = await entryID(adminPage, 'Cascade Parent');
      await createEntry(adminPage, 'Cascade Child', parentID);
      await adminPage.reload();

      let asked = '';
      adminPage.on('dialog', (d) => {
        asked = d.message();
        void d.dismiss();
      });
      await adminPage.getByTestId(`wiki-delete-${parentID}`).click();
      // Read the text first, then assert on it ([[negated-assertion-passes-while-absent]]).
      await expect.poll(() => asked, { timeout: 5_000 }).not.toBe('');
      expect(asked, 'the prompt must say the children go too')
        .toMatch(/also deletes/i);
    });
});

interface WikiRow { id: string; title: string }

async function wikiList(adminPage: Page): Promise<WikiRow[]> {
  const res = await adminPage.request.get(`${BACKEND}/api/admin/corpus/wiki?limit=200`);
  return await res.json() as WikiRow[];
}

async function entryID(adminPage: Page, title: string): Promise<string> {
  const rows = await wikiList(adminPage);
  return rows.find((e) => e.title === title)?.id ?? '';
}

async function createEntry(adminPage: Page, title: string, parentID: string): Promise<void> {
  await adminPage.getByTestId('wiki-new-btn').click();
  await adminPage.getByTestId('wiki-create-title').fill(title);
  await adminPage.getByTestId('wiki-create-body').fill(`body of ${title}`);
  await (parentID === ''
    ? Promise.resolve()
    : adminPage.getByTestId('wiki-create-parent').selectOption(parentID));
  await adminPage.getByTestId('wiki-create-submit').click();
  // Wait for **the entry to actually exist**, not for that unidentifiable toast (see the same comment in admin-wiki-crud).
  await expect
    .poll(async () => (await wikiList(adminPage)).some((e) => e.title === title),
      { message: `entry "${title}" must exist before the test moves on`, timeout: 10_000 })
    .toBe(true);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}
