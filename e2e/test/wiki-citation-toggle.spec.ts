// wiki-citation-toggle.spec.ts —— citation（show_as_source）是 owner 的控制，且**编辑不能偷偷改它**。
//
// 两个正交的旋钮，UI 必须让 owner 分得清（CorpusEntryForm 的 CitableField 就是在解释这件事）：
//   读到  —— AI 能不能把这条放进上下文 → role/code 的 corpus URI（/admin/roles、码上的收窄）
//   引用  —— 答案末尾列不列出处       → 这条笔记的 show_as_source
// 关掉 citation ≠ 藏起来：AI 照样读、照样用它组织回答，只是不署名。
//
// **真 bug（本 spec 的由来）**：`toEntryInput` 发的是 {title, body, tags, parent_id} —— 不含
// show_as_source。Go 的 `ShowAsSource bool` 收不到就解成 false 并原样写库。于是在 admin 里改一下
// 正文，这条的引用开关就被**静默关掉**：不报错、不提示。
//
// 所以这条 spec **必须驱动真表单**。我第一版写成了直接打后端 PATCH 并自带 show_as_source —— 那样
// 修不修都绿，因为 bug 根本不在后端：那是「测在缺口下面那一层」，本轮审计反复栽的同一个坑。

import { test, expect } from '@/fixtures/test';
import type { Locator, Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'citation@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'citation',
  fullName: 'Citation Owner',
};

const TITLE = 'Citable Wiki Entry';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// serial：这三条**共享一条 entry**（case 1 建，2/3 改它），而 beforeAll 里的 resetInstance 是
// **每个 worker 跑一次**的 —— 并行时后开的 worker 会把前一个正在用的实例清空。第一次跑就是这样：
// case 3 找不到那一行，因为另一个 worker 已经把 wiki 清成了空列表（后端日志里 GET /corpus/wiki
// 返回 `[]`）。共享可变实例 + 并行 worker = 假红。
test.describe.configure({ mode: 'serial' });
test.describe('corpus · citation is owner-controlled and survives an edit', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('the form explains citation and defaults it on', citableDefaultsOnAndIsExplained);
  test('editing the body does NOT silently turn citation off', editPreservesCitation);
  test('editing the body does NOT move the note to the root', editPreservesParent);
  test('the owner can turn citation off from the form, and it sticks', ownerCanTurnOff);
  test('opening the form fetches the entry ONCE, not in a loop', opensWithoutARequestStorm);
});

// opensWithoutARequestStorm —— F-A-17。useWikiDetail 的 effect 依赖整个 `actions` 对象，而
// use-corpus-actions 每次渲染都新造一个对象字面量；fetchDetail 自己会 setPending → 重渲染 → 新对象
// → effect 重跑 → 再 fetch：一个无限环。后端日志里是同一条 GET 每 6ms 一发。
//
// 而且它**装成加载中**：每轮 cleanup 都在 promise 落地前把 alive 置 false，setDetail 一次都不执行，
// 表单永远停在 loading…。owner 只会觉得"慢"。断言数请求，因为这个 bug 的本体就是请求数。
async function opensWithoutARequestStorm({ adminPage }: { adminPage: Page }): Promise<void> {
  let hits = 0;
  await adminPage.route(/\/api\/admin\/corpus\/wiki\/[0-9a-f-]{36}$/, (route) => {
    hits += 1;
    return route.continue();
  });
  const form = await openEditForm(adminPage, TITLE);
  // 等一个确定的信号（表单真的可交互），不是等墙钟。环若还在，光是走到这里就已经上百发了 ——
  // 事实上环还在时 openEditForm 根本等不到 loaded，所以这条计数是"就算它能加载出来也不许空转"。
  await expect(form.citable).toBeVisible();
  expect(hits, 'the lazy detail fetch must fire once per open, not spin').toBeLessThanOrEqual(2);
}

// citationOf —— 这条笔记当前的 show_as_source（从 owner 自己的 admin API 读回真值）。
async function citationOf(page: Page, title: string): Promise<boolean | undefined> {
  return await page.evaluate(async (t: string) => {
    const list = await (await fetch('/api/admin/corpus/wiki?limit=100', {
      credentials: 'include',
    })).json() as Array<{ id: string; title: string }>;
    const row = list.find((w) => w.title === t);
    if (!row) return undefined;
    const d = await (await fetch(`/api/admin/corpus/wiki/${row.id}`, {
      credentials: 'include',
    })).json() as { show_as_source?: boolean };
    return d.show_as_source;
  }, title);
}

// EditForm —— 一张 wiki 行的编辑表单的真实 testid 形状（从 prod GUI 上抄下来的，不是猜的）：
// 行是 `wiki-row-${id}`，行内的按钮是 `wiki-edit-${id}`，展开后的表单字段前缀是
// `wiki-edit-form-${id}-`，而 `wiki-edit-loaded-${id}` 是"已加载"的标记 —— 表单是**懒加载**的
// （点开先显示 loading…），所以必须等这个标记，不能等字段可见就动手。
interface EditForm {
  citable: Locator;
  body: Locator;
  submit: Locator;
}

// expandParentID —— 列表是**树**：只有根条目直接可见，孩子要先展开父节点那个 `▸` 才渲染出来。
// 不给这一步的话，找一条子条目的行会一直等到超时，而失败信息看起来像"这条根本没建出来"。
async function openEditForm(
  page: Page, title: string, expandParentID?: string,
): Promise<EditForm> {
  await gotoAdminSection(page, 'wiki');
  if (expandParentID !== undefined) {
    await page.getByTestId(`tree-toggle-wiki-row-${expandParentID}`).click();
  }
  // `.last()`：树里父行**包着**子行，所以 hasText 会同时命中两行。要的是最内层那条 ——
  // 拿到父行的话，后面点的是父条目的编辑按钮，测试会去改错的那条笔记而且照样绿。
  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: title }).last();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const id = (await row.getAttribute('data-testid'))!.replace('wiki-row-', '');
  await page.getByTestId(`wiki-edit-${id}`).click();
  // 懒加载：等表单真的到位，否则下面 fill 的是一个还没渲染的框。
  await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
  return {
    citable: page.getByTestId(`wiki-edit-form-${id}-citable`),
    body: page.getByTestId(`wiki-edit-form-${id}-body`),
    submit: page.getByTestId(`wiki-edit-form-${id}-submit`),
  };
}


// citableDefaultsOnAndIsExplained —— 新建默认可引用（对齐 DB 的 `NOT NULL DEFAULT true`），
// 而且 UI 必须**解释**这个勾是什么 —— owner 面对一个没有语境的 checkbox 只会猜错。
async function citableDefaultsOnAndIsExplained({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'wiki');
  await adminPage.getByTestId('wiki-new-btn').click();
  await adminPage.getByTestId('wiki-create-title').fill(TITLE);
  await adminPage.getByTestId('wiki-create-body').fill('A curated fact worth citing.');
  const citable = adminPage.getByTestId('wiki-create-citable');
  await expect(citable, 'the form offers the citation control').toBeVisible();
  await expect(citable, 'and it defaults ON, matching the DB default').toBeChecked();
  // 解释必须在场：读 vs 引是两件事，没有这句话 owner 会以为关掉 = 藏起来。
  // 文案走 i18n（corpus.citable.help）—— 断言的是渲染出来的那句话，不是 key：owner 读到的是句子。
  await expect(adminPage.getByText(/still reads this note/)).toBeVisible();
  await adminPage.getByTestId('wiki-create-submit').click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
  expect(await citationOf(adminPage, TITLE), 'new entry is citable').toBe(true);
}

// editPreservesCitation —— THE BUG，驱动真表单：只改正文然后保存，引用开关必须不动。
// RED（修复前）：表单不发 show_as_source → Go 解成 false → 这条静默变成不可引用。
async function editPreservesCitation({ adminPage }: { adminPage: Page }): Promise<void> {
  const form = await openEditForm(adminPage, TITLE);
  await expect(form.citable, 'precondition: this entry starts citable').toBeChecked();
  // 只碰正文。citation 那个勾一根手指都不碰 —— 这正是 owner 会做的事。
  await form.body.fill('An edited fact, still worth citing.');
  await form.submit.click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
  expect(
    await citationOf(adminPage, TITLE),
    'editing the body must not flip citation off — the owner never touched that control',
  ).toBe(true);
}

// CHILD —— editPreservesParent 用的子条目。跟 TITLE 那条分开：它要挂在别人下面。
const CHILD = 'A Child Of The Citable Entry';

// parentOf —— 这条笔记当前的 parent_id（从 owner 自己的 admin API 读回真值）。
async function parentOf(page: Page, title: string): Promise<string | null | undefined> {
  return await page.evaluate(async (t: string) => {
    const list = await (await fetch('/api/admin/corpus/wiki?limit=100', {
      credentials: 'include',
    })).json() as Array<{ id: string; title: string }>;
    const row = list.find((w) => w.title === t);
    if (!row) return undefined;
    const d = await (await fetch(`/api/admin/corpus/wiki/${row.id}`, {
      credentials: 'include',
    })).json() as { parent_id?: string | null };
    return d.parent_id ?? null;
  }, title);
}

// editPreservesParent —— F-L-28。跟上面那条是**同一个形状的第二次**：编辑表单清零了一个它
// 没有显示的字段。`corpus_write.go` 的 `ParentID` 是裸 `string`，所以"请求里没这个字段"和
// "把它挪到根"是同一个值；而编辑表单的 `initial` 里根本没有 parent_id，也没有 ParentSlot。
//
// **为什么这条比"引用开关被关掉"更重**：树是语料的地址。`uriOf` = `genre://<path>`，
// role/code 的 ACL glob 就长在这个 path 上。一条笔记被拍到根，它的 URI 就变了 ——
// owner 写的 `wiki://a/b/**` 从此拦不住它，而屏幕上什么都不会说。
//
// RED（修好之前）：只改正文保存一次，parent_id 从父条目的 id 变成 null。
async function editPreservesParent({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'wiki');
  // 父级下拉的**标签**是 `path ?? title`（CorpusEntryForm.tsx:26），不是标题本身 ——
  // 按标题挑会找不到那一项。按 id 挑，id 从行的 testid 上取（跟 openEditForm 同一条路）。
  const parentRow = adminPage.locator('[data-testid^="wiki-row-"]', { hasText: TITLE });
  await expect(parentRow).toBeVisible({ timeout: 10_000 });
  const parentID = (await parentRow.getAttribute('data-testid'))!.replace('wiki-row-', '');
  await adminPage.getByTestId('wiki-new-btn').click();
  await adminPage.getByTestId('wiki-create-title').fill(CHILD);
  await adminPage.getByTestId('wiki-create-body').fill('A fact that lives under another one.');
  // 挂到 TITLE 那条下面 —— 用真表单的父级选择器挑，不是打 API 塞进去。
  await adminPage.getByTestId('wiki-create-parent').selectOption(parentID);
  await adminPage.getByTestId('wiki-create-submit').click();

  // 等它真的落库（子条目在列表里被父节点收着，看不见 —— 等 API 的真值，别等一个不会出现的元素）。
  await expect.poll(
    () => parentOf(adminPage, CHILD), { timeout: 10_000 },
  ).toBe(parentID);
  // 前置条件本身要能红：挑父级这一步若没生效，下面的断言就变成"null 等于 null"，永远绿。
  const before = await parentOf(adminPage, CHILD);
  expect(before, 'precondition: the child really was created under a parent').not.toBeNull();

  const form = await openEditForm(adminPage, CHILD, parentID);
  await form.body.fill('An edited fact that still lives under the same parent.');
  await form.submit.click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });

  expect(
    await parentOf(adminPage, CHILD),
    'editing the body must not re-parent the note — the form never showed that control',
  ).toBe(before);
}

// ownerCanTurnOff —— 控制真的通到底：取消勾选 → 存 → 落库。
async function ownerCanTurnOff({ adminPage }: { adminPage: Page }): Promise<void> {
  const form = await openEditForm(adminPage, TITLE);
  await form.citable.uncheck();
  await form.submit.click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
  expect(await citationOf(adminPage, TITLE), 'the owner turned citation off').toBe(false);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  await request.dispose();
}
