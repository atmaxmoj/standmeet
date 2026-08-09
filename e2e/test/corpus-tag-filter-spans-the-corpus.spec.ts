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
    tags: [NEEDLE_TAG], source: 'mcp:e2e',
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

      await page.getByTestId('wiki-tag-filter').getByText(NEEDLE_TAG, { exact: true }).click();

      // NEAR 出现 = 筛选确实生效了(非空守卫,挡住「筛完什么都没有也算过」)。
      await expect(list).toContainText(NEAR_TITLE, { timeout: 30_000 });
      // FAR 出现 = 筛的是整个语料,不是已经加载的那一页。旧代码在这一行红。
      await expect(list).toContainText(FAR_TITLE, { timeout: 30_000 });
    });
});
