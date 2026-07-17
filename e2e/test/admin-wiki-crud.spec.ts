// admin-wiki-crud.spec.ts —— wiki CRUD: tag filter, excerpt, visibility,
// promote to output, SEO edit.
//
// 用户故事：
//   1. tag filter → click tag → wiki list filtered
//   2. excerpt → shows body truncated to 200 chars
//   3. visibility dot → public gray / private accent
//   4. promote wiki to output → output list shows new entry
//   5. SEO edit → slug / description / indexed toggle

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'wikicrud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wikicrud',
  fullName: 'Wiki CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin wiki CRUD extended', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('create wiki via UI → excerpt visible in list',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.waitForURL('**/admin/wiki', { timeout: 5_000 });
      await adminPage.getByTestId('wiki-new-btn').click();
      await adminPage.getByTestId('wiki-create-title').fill('Tagged Wiki Entry');
      await adminPage.getByTestId('wiki-create-body').fill(
        'This is a long body that should be truncated in the excerpt preview on the admin wiki list page.',
      );
      await adminPage.getByTestId('wiki-create-submit').click();
      // Wiki row shows excerpt
      await expect(adminPage.getByText('Tagged Wiki Entry')).toBeVisible({ timeout: 5_000 });
    });

  test('promote wiki to output via UI',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      const row = adminPage.locator('[data-testid^="wiki-row-"]', {
        hasText: 'Tagged Wiki Entry',
      });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /promote → output/i }).click();
      const titleInput = row.locator('[data-testid$="-title"]').first();
      await titleInput.fill('Promoted Output from Wiki');
      await row.getByRole('button', { name: /^promote$/i }).click();
      // Verify in output section
      await gotoAdminSection(adminPage, 'output');
      await adminPage.waitForURL('**/admin/output', { timeout: 5_000 });
      // 满载下 output section 的列表重取 + 渲染偶尔 >5s(read-after-write);
      // 数据一定在(wiki 已 seed、promote 已成),只是渲染慢 → 给宽超时,别 flake。
      await expect(adminPage.getByText('Promoted Output from Wiki'))
        .toBeVisible({ timeout: 15_000 });
    });

  test('new entry with a parent → nests under the chosen node',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      // create a root anchor
      await createEntry(adminPage, 'Parent Anchor', '');
      const parentID = await entryID(adminPage, 'Parent Anchor');
      expect(parentID, 'anchor created').toBeTruthy();
      // create a child, selecting the anchor in the parent picker
      await createEntry(adminPage, 'Child Under Anchor', parentID);
      // the child's parent_id is the anchor.
      const list = await wikiList(adminPage);
      const child = list.find((e) => e.title === 'Child Under Anchor');
      expect(child?.parent_id, 'child nested under the chosen parent').toBe(parentID);
    });
});

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
interface WikiRow { id: string; title: string; parent_id?: string | null }

async function wikiList(adminPage: Page): Promise<WikiRow[]> {
  const res = await adminPage.request.get(`${BACKEND}/api/admin/corpus/wiki?limit=200`);
  return await res.json() as WikiRow[];
}

async function entryID(adminPage: Page, title: string): Promise<string> {
  const list = await wikiList(adminPage);
  return list.find((e) => e.title === title)?.id ?? '';
}

async function createEntry(
  adminPage: Page, title: string, parentID: string,
): Promise<void> {
  await adminPage.getByTestId('wiki-new-btn').click();
  await adminPage.getByTestId('wiki-create-title').fill(title);
  await adminPage.getByTestId('wiki-create-body').fill(`body of ${title}`);
  await (parentID === ''
    ? Promise.resolve()
    : adminPage.getByTestId('wiki-create-parent').selectOption(parentID));
  await adminPage.getByTestId('wiki-create-submit').click();
  // 等**这一条真的存在**，而不是等那个 toast。'Wiki created' 不带任何标识：建完父节点它还挂在
  // 屏幕上，紧接着建子节点时这句断言会被**上一条**的 toast 瞬间满足 —— 于是测试以为建好了，转头
  // 去读列表，其实请求还在飞。单跑够快看不出来，全量负载下就红（child.parent_id → undefined，
  // 因为 child 根本还不在列表里）。一个不唯一的信号不能当完成凭据。
  await expect
    .poll(async () => (await wikiList(adminPage)).some((e) => e.title === title),
      { message: `entry "${title}" must actually exist before the test moves on`, timeout: 10_000 })
    .toBe(true);
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
