// wiki-delete-warns-about-its-children —— 删一个有子孙的条目，提示必须说清会连带删掉什么。
//
// **这条用例覆盖的是「父子都已经在当前列表里」那一半，它今天就是绿的。**
// 写它是因为 prod 上看到 `▾ 0` 挂在真的有子节点的行上（F-L-24），当时我推断
// `descendantCounts(shown)` 在懒加载树上永远数不到子节点 —— **推错了**：
// 小列表里父子都在 `shown` 里，计数是准的，所以这条用例在 e2e 里红不起来。
//
// 真正的触发条件是**分页**：prod 有 574 条 wiki，`shown` 只装当前页，跨页的子节点数不到。
// 要让它红，得先播够跨页的条目 —— 那一条还没写。**在写出来之前，那个 0 不改代码**
// （证不了红就不许改，见 iron rule ③）。
//
// 留着它的理由：它守住了"已加载那一半"的行为，而且把「它不覆盖什么」写在这里，
// 免得下一个人把这一条绿当成整条缺陷的保险（见 [[verifier-can-lie-about-its-own-coverage]]）。

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
      // 先取文本再判断（[[negated-assertion-passes-while-absent]]）。
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
  // 等**这一条真的存在**，不等那个不带标识的 toast（见 admin-wiki-crud 里同样的注释）。
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
