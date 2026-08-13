// search-degraded-is-visible.spec.ts —— F-S-3：检索退到降级路径时，产品要说出来。
//
// 设计里 `corpus_search` **就是走 Meilisearch 的那个工具**
// （`docs/design/open-work-multi-provider-gas-grep-i18n.md:267`）；`corpus_grep` 是第二条投影，
// 专门兜 Meili 分词器漏掉的串（词中子串、紧贴标点、CJK 双字，同文件 :306）。`MEILI_URL` 为空时
// `search.New` 返回 nil，检索退 Postgres 全文、**写入不再索引**（`boot_deps.go:142`）——
// 那是降级，不是另一种正常。
//
// **缺陷的形状是"沉默"**：`sysinfo.go` 原本写 `if p.search != nil` —— 没配就整条不列，于是
// **缺席跟"一切正常"在健康表上长得一模一样**，而缺席正是降级本身。db / redis / storage 都在
// 那张表里，唯独这一项在最该说话的时候消失。访客那侧也看不出来：中文查询返回空的那一轮，
// 模型同轮发的英文查询把答案撑住了（F-S-2）。**owner 因此可以一直不知道自己少了一个检索法。**
//
// **断言落在 `/admin/system` 的健康表，不是 dashboard 的 needs-your-hand。** 依赖状态本来就
// 住在这张表上；needs-your-hand 是"owner 该动手"的位置，而少一个检索法不像"没配 AI provider"
// 那样把访客挡在门外（答案照常出，只是更差），放进去是过度报警。
//
// **两例是一体的。** 只写降级那一例，"这一行报坏"可能只是因为它永远报坏；只写正常那一例，
// 又证明不了它会说话。两例一起才说明这一行**跟着真实状态动**
// （[[assertion-that-cannot-fail]]）。
//
// 这条用例会重建两次 backend 容器（进降级、出降级）。降级是启动期开关，没有更便宜的进法；
// afterAll 一定要恢复，否则后面每条搜索用例都会在另一条路上绿 —— 那正是这件事一直没被
// 发现的机制（[[which-path-is-the-green-on]]）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

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
  });

  test.afterAll(() => { setSearchDegraded(false); });

  test('engine attached → the health table names search and calls it fine',
    async ({ adminPage }) => {
      const row = (await searchHealthRow(adminPage)).toLowerCase();
      expect(row, 'a healthy engine is not reported as a problem')
        .not.toMatch(/no lexical index|not being indexed|fell back/);
      expect(row, 'and it is reported as ok').toContain('ok');
    });

  test('engine gone → the same row says the index is missing and writes are unindexed',
    async ({ adminPage }) => {
      setSearchDegraded(true);
      // 这一行**还在**本身就是断言 —— 以前 `if p.search != nil` 让它在这个状态下整条消失，
      // 而消失正是降级本身。searchHealthRow 等不到它就红在那一步。
      const row = (await searchHealthRow(adminPage)).toLowerCase();
      expect(row, 'the owner is told the lexical index is not attached')
        .toContain('no lexical index attached');
      // 第二个后果同样要说出来:写入不再进索引,所以引擎回来之后旧内容不会自己补上。
      expect(row, 'and that new writes are not being indexed')
        .toContain('not being indexed');
      expect(row, 'and the row is marked down, not ok').toContain('down');
    });
});

// searchHealthRow —— /admin/system 健康表里 search 那一整行（名字 + 说明 + 状态）。
//
// **两次踩坑都在这个函数里，写下来省得再踩：**
// 一、按 innerText 挑行只拿得到名字 —— name 和 detail 是两个 div，而要判的那句话在 detail 里。
//     现在按 `health-row-search` 取整行。
// 二、正对照断言过「面板可见」就往下走，可那时面板显示的是 `healthList` 的加载占位
//     （`—` / `loading…`），于是"数据还没到"被读成"这一行不存在"。等**具体那一行**出现，
//     天然把这两者分开（[[red-in-the-wrong-place]]）。
async function searchHealthRow(page: Page): Promise<string> {
  await goto(page, '/admin/system');
  const row = page.getByTestId('health-row-search');
  await expect(row, 'the search row is in the health table at all').toBeVisible({ timeout: 15_000 });
  return row.innerText();
}
