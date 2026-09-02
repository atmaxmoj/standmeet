// admin-obsidian.spec.ts —— /admin/obsidian renders the REAL, functional import/export (F-L-1).
//
// The page used to be a dead mockup: a fake vault path + hardcoded stat cells (mode/notes/size/
// last-sync) + two `<button>`s with no onClick. The old spec asserted those fake cells rendered —
// false confidence. It now renders the shared ObsidianBar (the same working folder-picker +
// export the writings section uses). These guards assert the actions are real, not dead.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'obsidian@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'obsidian',
  fullName: 'Obsidian Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin obsidian section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // UX-62 -- **the action that defines this product's ground truth leaves no evidence on
  // the page that it ever happened.**
  //
  // Seen firsthand in prod: 1028 notes in the corpus, yet the /admin/obsidian screen looks
  // identical to an empty instance -- two buttons and a caption. Clicking import does
  // produce `31 new · 20 updated · 1026 skipped`, but that line only survives until the
  // next reload: **the fact "when was the last import" simply doesn't exist in storage**.
  // Compare with the neighboring /admin/sources, where every row can at least say
  // `never fetched`.
  //
  // The criterion must be able to fail: first assert, on an instance that has **never
  // imported**, that it says "never imported" (not blank), then import once, reload, and
  // assert it can state that import's date. Blank is neither "never imported" nor
  // "imported" -- that's exactly the shape of this defect.
  //
  // Warning: **this must run before the import test**. The first half asserts "what does
  // an instance that has never imported say", while F-L-7 in this same file does a real
  // import. Run after it and "never imported" would obviously fail, but that red would be
  // my test ordering, not the product. **The state a criterion depends on is part of the
  // criterion** (bitten by exactly this on the note picker in F-L-59 today).
  test('the surface says whether an import ever happened (UX-62)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      const receipt = adminPage.getByTestId('obsidian-last-import');
      await expect(receipt, '没导过也要说话，不是留白').toBeVisible({ timeout: 15_000 });
      await expect(receipt, '没导过时说得明明白白').toContainText(/never imported/i);

      const done = adminPage.waitForResponse(
        (r) => r.url().includes('/obsidian/import') && r.request().method() === 'POST',
        { timeout: 60_000 },
      );
      await adminPage.getByTestId('obsidian-vault-input')
        .setInputFiles(makeGitBackedVault('receipt-note'));
      await done;

      // Reload -- the receipt must be **a fact that persisted**, not the warmth of that
      // one click.
      await gotoAdminSection(adminPage, 'obsidian');
      const after = adminPage.getByTestId('obsidian-last-import');
      await expect(after, '导过之后，刷新了也说得出来').toBeVisible({ timeout: 15_000 });
      await expect(after, '刷新之后不许退回「从没导过」')
        .not.toContainText(/never imported/i);
      await expect(after, '说得出是哪一天').toContainText(new Date().toISOString().slice(0, 10));
    });

  test('renders the real ObsidianBar (folder picker), not the dead mockup (F-L-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await adminPage.waitForURL('**/admin/obsidian', { timeout: 5_000 });
      // The real, functional component + its vault-folder <input> — the mockup had neither.
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      await expect(adminPage.getByTestId('obsidian-vault-input')).toBeAttached();
      // The old fake stat cell is gone (it implied a live-synced vault that never existed).
      await expect(adminPage.getByTestId('vault-stat-mode')).toHaveCount(0);
    });

  test('the export button actually downloads the corpus vault (F-L-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      // A dead button fires no download; the real one hits GET /obsidian/export → a .zip.
      const download = adminPage.waitForEvent('download', { timeout: 10_000 });
      await adminPage.getByRole('button', { name: /export/i }).click();
      expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    });

  // F-L-7 —— a REAL Obsidian vault is normally a git repo. The picker hands the browser the whole
  // folder, so uploading it verbatim posted thousands of .git objects the server drops on arrival,
  // blowing the multipart part limit: importing a git-backed vault failed outright with
  // "message too large". Every other sync spec posts a synthetic 2-file vault straight to the API,
  // bypassing the client's file selection — which is exactly why this was invisible.
  // This drives the REAL picker with a REAL-shaped vault.
  test('imports a git-backed vault — .git is not uploaded (F-L-7)',
    async ({ adminPage }) => {
      const vault = makeGitBackedVault();
      await gotoAdminSection(adminPage, 'obsidian');
      await expect(adminPage.getByTestId('obsidian-vault-input')).toBeAttached();

      const done = adminPage.waitForResponse(
        (r) => r.url().includes('/obsidian/import') && r.request().method() === 'POST',
        { timeout: 60_000 },
      );
      await adminPage.getByTestId('obsidian-vault-input').setInputFiles(vault);
      const res = await done;

      expect(res.status(), 'a git-backed vault must import, not 400 "message too large"').toBe(200);
      const body: unknown = await res.json();
      const parsed = ImportOutcomeSchema.parse(body);
      expect(parsed.errors, 'the vault imports cleanly').toEqual([]);
      // The real note landed; the ~1200 .git objects never left the browser.
      expect(parsed.created + parsed.updated, 'the vault content is ingested').toBeGreaterThan(0);
    });

  // F-L-62 -- **the receipt doesn't say what that import deleted.**
  //
  // What actually happened in prod: a full (= authoritative) import pruned 10 notes (a
  // whole `wiki/math/orbit/` subtree plus a `type-theory` note), and the screen showed
  // nothing but `4 new · 9 updated · 1055 unchanged` from start to finish.
  // The three numbers only cover the reversible half; **the one irreversible half has no
  // number at all**. The backend computes it the whole time (`ImportResult.Deleted`, the
  // API sends it too), the frontend parses it into the schema and then discards it.
  //
  // The criterion must be able to fail: import two notes, then import one -- the second
  // import must prune one, and that line must say so, and after a reload the persisted
  // line must still say so too (the receipt is a fact, not the warmth of that one click).
  test('the receipt says what the import DELETED, not only what it added (F-L-62)',
    ({ adminPage }) => receiptReportsDeletions(adminPage));
});

async function receiptReportsDeletions(page: Page): Promise<void> {
  await gotoAdminSection(page, 'obsidian');
  await importVault(page, makeVaultOf('prune-keep', 'prune-drop'));
  // The second import has one fewer note -- a full upload is authoritative: absence means
  // deletion.
  await importVault(page, makeVaultOf('prune-keep'));

  await expect(
    page.getByTestId('obsidian-import-result'),
    '剪掉了笔记，那一行就必须有个删除的数',
  ).toContainText(/[1-9]\d* deleted/);

  await gotoAdminSection(page, 'obsidian');
  await expect(
    page.getByTestId('obsidian-last-import'),
    '刷新之后存下来的那一行也要说得出删了几条',
  ).toContainText(/[1-9]\d* deleted/);
}

// importVault -- goes through the same path the owner actually clicks (folder picker),
// and waits for this import's response.
async function importVault(page: Page, dir: string): Promise<void> {
  const done = page.waitForResponse(
    (r) => r.url().includes('/obsidian/import') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByTestId('obsidian-vault-input').setInputFiles(dir);
  await done;
}

// makeVaultOf -- a tiny vault holding only wiki notes: give it one fewer note on the
// second call and that models "the owner deleted it in the vault".
function makeVaultOf(...notes: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'standmeet-prune-'));
  mkdirSync(join(root, 'wiki'), { recursive: true });
  for (const n of notes) {
    writeFileSync(join(root, 'wiki', `${n}.md`), `---\npublish: true\n---\n\n${n} body.\n`);
  }
  return root;
}

const ImportOutcomeSchema = z.object({
  created: z.number(), updated: z.number(), skipped: z.number(), errors: z.array(z.string()),
});

// makeGitBackedVault —— a vault shaped like a real one: real notes PLUS a .git directory big enough
// to blow the multipart part limit if it were uploaded (a real vault's .git holds thousands of
// objects). Also carries the .obsidian CSS config, which IS harvested and must still be sent.
//
// `note` lets each test bring **its own** note: if two tests import the same vault back
// to back, the second import is all unchanged -- so F-L-7's "content landed" assertion
// would go red on **the previous test having already imported it**, not on the product
// (hit this exact collision when I put UX-62 ahead of it).
function makeGitBackedVault(note = 'a-real-note'): string {
  const root = mkdtempSync(join(tmpdir(), 'standmeet-vault-'));
  mkdirSync(join(root, 'raw'), { recursive: true });
  writeFileSync(join(root, 'raw', `${note}.md`), `---\ntags: [x]\n---\n\n${note} content.\n`);
  mkdirSync(join(root, '.obsidian', 'snippets'), { recursive: true });
  writeFileSync(join(root, '.obsidian', 'snippets', 'custom.css'), '.x{color:red}');
  // the part-count bomb: what a version-controlled vault actually carries.
  const objects = join(root, '.git', 'objects', 'ab');
  mkdirSync(objects, { recursive: true });
  for (let i = 0; i < 1200; i++) writeFileSync(join(objects, `obj${i}`), 'x');
  return root;
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
