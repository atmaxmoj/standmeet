// role-corpus-picker.spec.ts —— corpus 准入是**勾出来的**，不是默写出来的（F-A-14）。
//
// 由来：role 的授权面和 code 的收回面都是裸 textarea，owner 得记住 scheme + 一条笔记确切的服务端
// slug（`subjectivity://cv`）。没有发现性、没有校验，打错还是静默的 —— 授权那侧"静默少授"跟
// F-A-13 那句谎一样，都指向"看起来没事"。
//
// 这条 spec 断言的是**通到底**（勾 → 存 → 落库的真值），不是"picker 渲染出来了"：一个能勾但存不
// 进去的 picker 会在截图里看着完美。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { BACKEND } from '@/fixtures/vault-sync';

const OWNER = {
  email: 'picker@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'picker',
  fullName: 'Picker Owner',
};

const ROLE = 'pickme';
// PICKER —— 这张 role 卡的 picker 实例前缀。testid 按实例分命名空间：一页上每张卡都有一个 picker，
// 不带前缀的 `scope-genre-wiki` 会同时命中好几个（第一版就是这么红的）。
const PICKER = `role-corpus-picker-${ROLE}`;
// FOREIGN —— 一条**树上没有哪一行对应**的 glob。picker 必须原样留着它：一个把值往复翻译的 picker
// 会在保存时静默删掉 owner 手写的东西。
const FOREIGN = 'wiki://legacy/*/draft';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });
test.describe('ACL · the corpus grant is picked from the real tree', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('the picker offers every ACL genre — including subjectivity', offersGenres);
  test('ticking a genre writes its glob, and saving it sticks', tickGenreAndSave);
  test('a glob the tree cannot express is kept, not silently dropped', keepsForeignGlobs);
});

async function openRoles(page: Page) {
  await gotoAdminSection(page, 'roles');
  await expect(page.getByTestId(PICKER)).toBeVisible({ timeout: 10_000 });
}

// grantOf —— 这个 role 现在真正的 corpus_uris（从 owner 自己的 API 读回真值）。
async function grantOf(page: Page): Promise<string[]> {
  return await page.evaluate(async (name: string) => {
    const roles = await (await fetch('/api/admin/roles/', { credentials: 'include' }))
      .json() as Array<{ name: string; corpus_uris: string[] }>;
    return roles.find((r) => r.name === name)?.corpus_uris ?? [];
  }, ROLE);
}

// offersGenres —— subjectivity 尤其要在：CV 住在那里，它是这整个功能的动机，而它此前连树都没有
// （F-A-15）。一个少了 subjectivity 的 picker 对真正的用例毫无用处。
async function offersGenres({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  for (const genre of ['wiki', 'output', 'writing', 'subjectivity']) {
    await expect(
      adminPage.getByTestId(`${PICKER}-genre-${genre}`),
      `${genre} is an ACL genre — the picker must offer it`,
    ).toBeVisible();
  }
  // raw 是硬编码 deny（MatchesAnyCorpusGlob 第一行）；给它一个勾就是骗人。
  await expect(adminPage.getByTestId(`${PICKER}-genre-raw`)).toHaveCount(0);
}

// tickGenreAndSave —— 通到底：勾 → save → 落库。
async function tickGenreAndSave({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  expect(await grantOf(adminPage), 'precondition: starts empty').toEqual([]);
  await adminPage.getByTestId(`${PICKER}-genre-subjectivity`).check();
  await adminPage.getByTestId(`role-corpus-save-${ROLE}`).click();
  await expect.poll(
    () => grantOf(adminPage),
    { message: 'the ticked glob must reach the DB, not just the checkbox' },
  ).toContain('subjectivity://**');
}

// keepsForeignGlobs —— owner 手写的怪 glob 不能被 picker 吃掉。这是往复翻译最容易犯的错：
// 只把树认得的写回去，其余无声消失 —— 而消失的方向是"少授"，没人会立刻发现。
async function keepsForeignGlobs({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  const box = adminPage.getByTestId(`role-corpus-uris-${ROLE}`);
  await box.fill(`subjectivity://**\n${FOREIGN}`);
  await expect(
    adminPage.getByTestId(`${PICKER}-foreign-globs`),
    'and the owner can SEE that it is still there',
  ).toContainText('legacy');
  // 勾一个别的 —— 一次会重写整份列表的操作。
  await adminPage.getByTestId(`${PICKER}-genre-wiki`).check();
  await adminPage.getByTestId(`role-corpus-save-${ROLE}`).click();
  await expect.poll(
    () => grantOf(adminPage),
    { message: 'a hand-written glob must survive a picker interaction' },
  ).toContain(FOREIGN);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createRole(request, csrf, { name: ROLE, description: 'picker target', corpus_uris: [] });
  await seedNote(request, csrf);
  await request.dispose();
}

// seedNote —— 树上得真有东西可勾（空树也能让"勾不到"看起来像通过）。
async function seedNote(
  request: Awaited<ReturnType<Playwright['request']['newContext']>>, csrf: string,
): Promise<void> {
  await request.post(`${BACKEND}/api/admin/corpus/wiki`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title: 'Thinking', body: 'A curated fact.', tags: ['node'], show_as_source: true },
  });
}
