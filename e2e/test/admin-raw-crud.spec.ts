// admin-raw-crud.spec.ts —— raw entries: DumpBox, filter, promote, archive, edit.
//
// 用户故事：
//   1. DumpBox → 选 source chip → 输入 → dump → 新行出现
//   2. filter 切换 (unprocessed / promoted / all) → list 过滤
//   3. promote → wiki modal → 填 title → confirm → raw 变 "promoted"
//   4. 编辑 body → save → body 更新

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

  // F-L-16 —— 删掉一条之后,列表少了一行,而**四个计数一个都没动**:标题的 "N unprocessed"、
  // 四个 tab、侧栏 badge、pulse 栏,全都还在报删之前的数,要整页 reload 才对得上。
  // 它们读的是同一份 growth 资源,而那份资源在 mutation 之后从来没被作废过 —— 收口点
  // (`run()` 里的 bumpCorpusEpoch)早就在了,后面只挂了树,没挂计数。
  // 手工发现于 2026-08-07 的 corpus-raw 第 3 项:后端删得干干净净(行 404、素材从 bucket 里也没了),
  // 屏幕上却四处坚称它还在。
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
  // 两条:删掉一条之后还剩至少一条,badge 才不会因为归零而整个消失(那是另一件事)。
  // 等的是 **POST 的响应**,不是行出现 —— 行是乐观插入的,它先出现,服务器可能还没落库,
  // 那样下面那个 reload 读到的基线就是假的(第一版就这么假红过)。
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
  // 整页重来一次,让基线是**真**的 —— 否则拿一个本来就旧的数去做减法,红绿都说明不了问题。
  await page.reload();
  const row = page.locator('[data-testid^="raw-delete-"]').first();
  await expect(row).toBeVisible({ timeout: 5_000 });

  const header = page.getByTestId('section-header');
  await expect(header).toContainText(/[1-9]\d* unprocessed/, { timeout: 10_000 });
  const before = countIn(await header.innerText());
  expect(before, '基线必须 ≥2,否则删完 badge 归零会盖住真正要测的东西').toBeGreaterThanOrEqual(2);

  // 先测**创建**这条路 —— 它绕开 useCorpusActions 走自己的 doAddRaw,所以第一版修完删除之后
  // 它还是不动:两条路各抄了一份作废动作,后加的那半只进了其中一份(F-L-16)。
  await page.getByTestId('dump-input').fill('One more, to watch the counter go up.');
  await page.getByRole('button', { name: /dump/i }).click();
  await expect(header, '粘一条进来,标题上的数就得涨').toContainText(`${before + 1} unprocessed`);
  await expect(
    page.getByTestId('badge-raw'),
    '侧栏 badge 也一样,不许等自己的轮询',
  ).toHaveText(String(before + 1));

  // 上面刚加了一条,所以此刻是 before+1;删掉一条应该正好回到 before。
  page.once('dialog', (d) => void d.accept());
  await page.locator('[data-testid^="raw-delete-"]').first().click();

  // 不 reload。删完这一刻标题就得少一个。
  await expect(header, '标题上的数必须跟着列表一起动').toContainText(`${before} unprocessed`);
  // 侧栏 badge 说的是同一件事,那它就得报同一个数(而不是等自己 60 秒的轮询)。
  await expect(
    page.getByTestId('badge-raw'),
    '侧栏 badge 跟标题读的必须是同一份数',
  ).toHaveText(String(before));
}

// countIn —— 从 "raw · 12 unprocessed" 里取那个数。
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
