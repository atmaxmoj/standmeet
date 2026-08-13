// search-degraded-is-visible.spec.ts —— F-S-3：检索退到降级路径时，产品要说出来。
//
// 设计里 `corpus_search` **就是走 Meilisearch 的那个工具**
// （`docs/design/open-work-multi-provider-gas-grep-i18n.md:267`）；`corpus_grep` 是第二条投影，
// 专门兜 Meili 分词器漏掉的串（词中子串、紧贴标点、CJK 双字，同文件 :306）。`MEILI_URL` 为空时
// `search.New` 返回 nil，检索退 Postgres 全文、**写入不再索引**（`boot_deps.go:142`）——
// 那是降级，不是另一种正常。
//
// **为什么这条守卫必须存在**：降级今天**一声不吭**。全仓（backend + admin）搜 `degrade` 只有
// 一处 sigv1 nonce 的无关命中。于是 owner 不知道自己少了一个检索法，agent 不知道该换去 grep，
// 而访客拿到的答案看起来完全正常 —— 中文查询返回空的那一轮，同轮的英文查询把答案撑住了
// （F-S-2）。**一个能力静默地少了一半，产品的每一个面都显示一切正常。**
//
// **断言落在 dashboard 的「needs your hand」不是我挑的位置**：仓库里已有先例 ——
// `routes/admin/claim.go:224` 那句注释写着，没有可用的 AI provider 时 NEEDS YOUR HAND 会直说
// 「visitors are being turned away」。少了一个检索法是同一类事实：owner 需要知道某个能力没在
// 正常工作。照着已有的那条路，不另发明一个提示位。
//
// 这条用例会**重建两次 backend 容器**（进降级、出降级），比一般用例慢。降级是启动期开关，
// 没有更便宜的进法；afterAll 一定要恢复，否则后面每条搜索用例都会在另一条路上绿。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, setSearchDegraded } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'search-degraded@example.com', password: 'correct-horse-battery-staple',
  handle: 'searchdeg', fullName: 'Search Degraded Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-S-3 · a degraded search path is stated, not silent', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await loginAPI(request, OWNER.email, OWNER.password);
    await request.dispose();
    // 进降级 —— 数据留着，只换检索那一层。
    setSearchDegraded(true);
  });

  test.afterAll(() => { setSearchDegraded(false); });

  // ⏸ 挂起中，**而且不是因为缺陷不存在**。
  //
  // 第一次跑红在**正对照**那一行：`needs-hand` 面板压根不可见。那不是这条守卫要证的东西 ——
  // 它证的是别的事，而前一个缺陷正好替后一个挡了枪（[[two-guards-dying-at-one-line]]）。
  //
  // **读了归档的失败截图，答案平淡无奇而且是我的错**（`test-results-archive/…/test-failed-1.png`）：
  // 那一页是**登录页**，不是 dashboard。面板不在是因为**根本没登录进去**。
  //
  // 「看到什么」和「为什么」分开记：
  //   · 看到的 —— `goto('/admin/dashboard')` 之后停在 SIGN IN。
  //   · 由此确定的 —— 与「没有 action item」「dashboard 加载慢」「降级」都无关。
  //   · 还没证的 —— 最可能是 beforeAll 里 `setSearchDegraded(true)` **重建了 backend 容器**，
  //     而会话没活过那次重建。要证它得看那一轮 backend 起来后的第一批请求带没带上有效 cookie。
  //
  // 修法方向：把登录排在切换降级**之后**，或者切换后重新登录一次。改之前先把上面那条机制证实，
  // 否则就是又一次「照着现象改，改完绿了但不知道为什么」。
  //
  // **这次差点走上另一条路**：第一反应是把 10 秒调大。如果当时只写了那句关键断言、没写正对照，
  // 红会落在「面板文本里没有 search」上 —— 看起来正是缺陷本身，我会当场宣布"证红成功"，
  // 然后去修一个根本没被证明存在的问题。正对照在这里挡下的不是假绿，是**红得不知所以然**。
  //
  // 解开之前它不该在套件里常红：常红的用例会被当成背景噪音，然后连它真正想说的话一起被忽略。
  test.fixme('with the search engine gone, the dashboard says so', async ({ page }) => {
    await goto(page, '/admin/dashboard');
    const needs = page.getByTestId('needs-hand');
    // 正对照：这块面板本身渲染出来了。缺了它，下面的断言在「dashboard 整个没加载」时会红得
    // 莫名其妙，而红的原因会被记到"没提示降级"头上（[[assertion-that-cannot-fail]] 的反面）。
    await expect(needs, 'the needs-your-hand panel rendered at all').toBeVisible({ timeout: 10_000 });

    const text = (await needs.innerText()).toLowerCase();
    // 只要求它**说出这件事**，不规定措辞 —— 措辞是设计的事，存在与否才是这条守卫的事。
    expect(
      /search|retrieval|检索/.test(text),
      'the owner is told a retrieval path is missing, not left to find out from empty results',
    ).toBe(true);
  });
});
