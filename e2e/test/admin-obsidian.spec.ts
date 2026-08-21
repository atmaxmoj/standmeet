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

  // UX-62 —— **定义这个产品 ground truth 的那个操作，页面上没有任何证据表明它发生过。**
  //
  // prod 上亲眼看的：语料里 1028 条笔记，而 /admin/obsidian 那一屏跟一个空实例长得一模一样
  // ——两颗按钮加一段说明。点一次导入之后确实会冒出 `31 new · 20 updated · 1026 skipped`，
  // 但那行只活到下一次刷新：**「上次导入是什么时候」这个事实在库里根本不存在**。
  // 对照隔壁 /admin/sources，每一行至少说得出 `never fetched`。
  //
  // 判据要能判负：先在**没导过**的实例上断它说「从没导过」（而不是空白），再导一次、
  // 重新加载，断它说得出这次的日期。空白既不是「从没导过」也不是「导过」—— 那正是这条
  // 缺陷的样子。
  //
  // ⚠️ **必须排在导入那条之前**：前半句判的是「一个从没导过的实例说什么」，而同文件的
  // F-L-7 会真的导一次。排在它后面的话「never imported」当然不成立，而那红的是我的用例、
  // 不是产品。**判据依赖的状态也是判据的一部分**（今天在 F-L-59 的选笔记上刚吃过一次）。
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

      // 重新加载 —— 回执必须是**存下来的事实**，不是那一次点击的余温。
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

  // F-L-62 —— **回执不说那次导入删了什么。**
  //
  // prod 上真发生的：一次整份导入（= authoritative）剪掉了 10 条笔记（一整棵 `wiki/math/orbit/`
  // 加一条 `type-theory`），屏幕上从头到尾只有 `4 new · 9 updated · 1055 unchanged`。
  // 三个数说的全是可逆的那一半；**唯一不可逆的那一半没有数字**。后端一直在算它
  // （`ImportResult.Deleted`，API 也发了），前端把它解析进 schema 之后就扔了。
  //
  // 判据要能判负：先导两条，再导一条 —— 第二次必定剪掉一条，那一行必须说得出来，
  // 而且刷新之后存下来的那一行也要说得出来（回执是事实，不是那一次点击的余温）。
  test('the receipt says what the import DELETED, not only what it added (F-L-62)',
    ({ adminPage }) => receiptReportsDeletions(adminPage));
});

async function receiptReportsDeletions(page: Page): Promise<void> {
  await gotoAdminSection(page, 'obsidian');
  await importVault(page, makeVaultOf('prune-keep', 'prune-drop'));
  // 第二次少了一条 —— 整份上传就是 authoritative，缺席即删除。
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

// importVault —— 走 owner 真点的那条路（文件夹选择器），等这一次导入的响应回来。
async function importVault(page: Page, dir: string): Promise<void> {
  const done = page.waitForResponse(
    (r) => r.url().includes('/obsidian/import') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByTestId('obsidian-vault-input').setInputFiles(dir);
  await done;
}

// makeVaultOf —— 一个只有 wiki 笔记的小 vault：第二次少给一条，就是「owner 在 vault 里删了它」。
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
// `note` 让每条用例带**自己的**那条笔记：两条用例先后导入同一个 vault 的话，第二次
// 全是 unchanged —— 于是 F-L-7 的「内容进库了」断言会红在**上一条用例已经导过**这件事上，
// 而不是产品身上（我把 UX-62 排到它前面时当场撞了一次）。
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
