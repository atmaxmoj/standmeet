// corpus-tag-filter-spans-the-corpus.spec.ts —— F-L-23:标签筛选筛的必须是**整个语料**,
// 不是已经加载的那一页。
//
// 真实环境里驱出来的:`/admin/wiki` 表头写 `574 entries`,点 `math` 标签只剩 1 条,而库里有
// **137** 条 wiki 带这个标签。原因是 `WikiSection.tsx` 在选中标签时把分页数据源整个关掉,
// 退回内存里那一页做客户端过滤;表头那个数来自另一个真 COUNT,于是两个数并排,谁也没说自己
// 是哪个。
//
// 这一条的形状照着那个成因造:让带标签的那条**落在第一页之外**。它先建(created_at 最早),
// 而分页是 created_at DESC,所以它排在最后;再建满一整页不带标签的。旧代码只看得见第一页,
// 于是筛出 0 条 —— 而正确答案是 1 条。
//
// 断言看**那条笔记在不在**,不是数字:数字会随页大小和种子数漂,而「筛选必须够得到它」不会。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { callTool } from '@/fixtures/mcp';
import { initMCP } from '@/fixtures/mcp';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// NEEDLE_TAG —— 唯一,免得撞上别的种子。**同一个标签挂两条**:
//   NEAR —— 最后建(created_at 最新)→ 落在第一页,标签 chip 因此渲得出来,点得到;
//   FAR  —— 最先建(created_at 最早)→ 落在已加载窗口之外,只有真正下推到查询的筛选够得到。
// 这个形状是照着 prod 上看到的样子造的:`math` 的 chip 在,点下去却只出 1 条,而库里有 137。
//
// 第一版我只种了 FAR 一条,结果**在旧代码上也绿** —— 因为为了让 chip 渲得出来,我把它塞进了
// 列表钩子的窗口里,而客户端筛选筛的正是那个窗口。chip 列表和筛选共用同一个窗口,所以筛不到的
// 条目连 chip 都不会有:这个缺陷纯靠点击是触发不了的,得先从别处知道那个标签存在。
const NEEDLE_TAG = 'needle-tag';
// FAR_ONLY_TAG —— **只**挂在 FAR 上的标签。标签行如果从已加载的那一页推,它连 chip 都不会有 ——
// 点不到,也就无从发现自己漏了什么。真 vault 上 `rate-reduction` 就是这样消失的。
const FAR_ONLY_TAG = 'far-only-tag';
const NEAR_TITLE = 'needle-on-the-first-page';
const FAR_TITLE = 'needle-beyond-the-loaded-window';
// FILLER —— 后端 gridPageSize 是 30,列表钩子按 defaultCorpusLimit(50)取行。60 条填充把 FAR
// 推到两者之外。
const FILLER = 60;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

async function seedCorpus(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  void csrf;
  const token = await createAPIToken(request, csrf, 'tag-filter-seed');
  const sid = await initMCP(request, token);

  // FAR 先建 —— created_at 最早,分页按 DESC 排,它落在已加载窗口之外。
  await callTool(request, token, sid, 'corpus.create', {
    genre: 'wiki', title: FAR_TITLE, body: 'the tagged entry past the loaded window',
    tags: [NEEDLE_TAG, FAR_ONLY_TAG], source: 'mcp:e2e',
  });
  for (let i = 0; i < FILLER; i += 1) {
    await callTool(request, token, sid, 'corpus.create', {
      genre: 'wiki', title: `filler-${String(i).padStart(2, '0')}`,
      body: 'filler', tags: [], source: 'mcp:e2e',
    });
  }
  // NEAR 最后建 —— 落在第一页,标签 chip 靠它渲出来。
  await callTool(request, token, sid, 'corpus.create', {
    genre: 'wiki', title: NEAR_TITLE, body: 'the tagged entry on the first page',
    tags: [NEEDLE_TAG], source: 'mcp:e2e',
  });
  await request.dispose();
}

test.describe('corpus · tag filter spans the corpus, not one page', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    await seedCorpus(playwright);
  });

  // 标签筛选必须够得到已加载窗口之外的那条(F-L-23)。
  test('a tagged entry past the loaded window is still found by its tag',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await page.getByTestId('admin-nav-wiki').click();
      await page.waitForURL('**/admin/wiki**');

      // 分页只在网格视图上;树是懒加载的层级,不是这条要测的东西。
      await page.getByRole('button', { name: /grid/i }).click();

      const list = page.getByTestId('wiki-list');
      await expect(list).toBeVisible({ timeout: 30_000 });
      // 非空守卫:先证第一页真的在渲东西。
      await expect(list).toContainText('filler-', { timeout: 30_000 });
      // 而 FAR 本来就不在第一页 —— 这一步坐实了「筛选必须跨越已加载的那一页」才是真需求。
      await expect(list).not.toContainText(FAR_TITLE);

      // 标签行必须来自整个 genre:只挂在窗口外那条上的标签也得有 chip,否则它点不到,
      // 而「点不到」跟「没有这个标签」在屏幕上长得一模一样。
      const chips = page.getByTestId('wiki-tag-filter');
      await expect(chips.getByText(FAR_ONLY_TAG, { exact: true })).toBeVisible({ timeout: 30_000 });

      await chips.getByText(NEEDLE_TAG, { exact: true }).click();

      // NEAR 出现 = 筛选确实生效了(非空守卫,挡住「筛完什么都没有也算过」)。
      await expect(list).toContainText(NEAR_TITLE, { timeout: 30_000 });
      // FAR 出现 = 筛的是整个语料,不是已经加载的那一页。旧代码在这一行红。
      await expect(list).toContainText(FAR_TITLE, { timeout: 30_000 });
    });

  // F-L-30 —— 上面那条**先切到网格**再点标签（第 95 行），于是树视图那条路从没被走过。
  // prod 上的样子：树视图里点 `recursive-harness`，chip 亮起来，而树**一行都没变** ——
  // 十个根节点原样列着；同一刻切到网格，几十条挂着这个标签的笔记都在。
  // 同一个标签、同一时刻、两个视图给出相反的答案，而亮着的 chip 在断言「已按它筛过」。
  //
  // 归因：`CorpusTreeGrid.tsx:52` 的树分支渲的是 `CorpusLazyTree`，它**根本不收 rows** ——
  // 于是 `WikiSection.tsx:136` 那句 `filterByTag(rows, activeTag)` 算完就被扔了。
  // F-L-23 把网格那半修好了，树这半在同一次改动里**静默变成了空操作**。
  //
  // 判据不钉住"树必须能筛"（那是新能力）：钉住**屏幕不许说谎** —— 选了标签之后，
  // 看到的东西必须真的是那个标签的答案。产品用切到网格来满足它。
  test('picking a tag in tree view does not leave an unfiltered tree under a lit chip',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await page.getByTestId('admin-nav-wiki').click();
      await page.waitForURL('**/admin/wiki**');
      await page.getByRole('button', { name: /tree/i }).click();

      const list = page.getByTestId('wiki-list');
      await expect(list).toBeVisible({ timeout: 30_000 });
      const chips = page.getByTestId('wiki-tag-filter');
      await chips.getByText(NEEDLE_TAG, { exact: true }).click();
      await expect(list).toBeVisible({ timeout: 30_000 });

      // 选了标签之后屏幕上的东西必须**是这个标签的答案**：两条挂着它的都在，
      // 而没挂它的填充条目不在。旧代码在这里红 —— 树纹丝不动，filler 全在、FAR 不在。
      await expect(list, '挂着这个标签的那两条都得在').toContainText(NEAR_TITLE, { timeout: 30_000 });
      await expect(list, '窗口外那条也得在').toContainText(FAR_TITLE, { timeout: 30_000 });
      const shown = await list.innerText();
      expect(
        shown.includes('filler-'),
        '亮着的 chip 在说「已按这个标签筛过」，那就不该还列着没挂它的条目',
      ).toBe(false);
    });
});
