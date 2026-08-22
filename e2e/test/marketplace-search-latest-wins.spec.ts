// marketplace-search-latest-wins.spec.ts —— F-F-6：慢一点的旧回包不许盖掉刚搜出来的结果。
//
// `use-marketplace-search.ts` 的 effect 每次 query 变化发一次请求，而 `loadPage` **既不排序
// 也不取消** —— 谁后回来谁赢。于是「空查询的整份目录」只要比「带 q 的那一次」回得晚，
// 屏幕上就是**未过滤的目录 + 搜索框里你打的那个词**：owner 手打一个词、拿到一屏不相干的
// 结果，而没有任何一处报错。
//
// 这条以真现象为准：全套里 `marketplace-needs-connector` 红过两次（18 秒），单跑 7.9 秒绿。
// 失败快照里搜索框写着 `tz-booking`，网格是 Algorithmic Art / Brand Guidelines / …
//
// **只压慢第一发（无 q 的那一次）**，不碰带 q 的那一发 —— 这样红只可能意味着
// 「后到的旧回包赢了」。不注延迟这条永远绿，所以延迟就是这条用例的判据本身。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

// 那条要连接器的技能（mock 市场目录里追加的），拿它当搜索目标。
const TARGET = 'tz-booking';
// 网格里的每一张卡。**不猜某一张邻居的 id** —— 猜错的话 `toHaveCount(0)` 恒真，
// 那条断言就永远发现不了任何东西（[[assertion-that-cannot-fail]]）。数总数不会猜错：
// 搜完只该剩目标那一张，屏幕上是整份目录时它是两位数。
const ANY_CARD = '[data-testid^="market-skill-"]';

// 未过滤时一页 12 张（PAGE_LIMIT）。过滤之后必须比这少 —— 否则「过滤前后一样多」也能
// 让下面那条「没变」的断言通过，而那正是缺陷本身的样子。
const FULL_LISTING_MIN = 12;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

const SEARCH_PATH = '**/api/admin/marketplace/search*';

function isUnfiltered(url: string): boolean {
  return new URL(url).searchParams.get('q') === null;
}

// holdUnfilteredSearch —— 把**没有 `q`** 的那一发扣住，直到调用方放行；带 q 的照常。
//
// **不是 sleep。** 压一个固定的秒数只是「希望它回得够晚」；扣住再放行让顺序成为事实：
// 带 q 的那一发一定先到，整份目录那一发一定后到。这条用例要问的正是「后到的旧回包会不会赢」。
// **注册要 await。** 第一版写的是 `void page.route(...)`，于是导航可能赶在路由装上之前 ——
// 那一发根本没被扣住，红/绿又变回看运气。
async function holdUnfilteredSearch(page: Page): Promise<{ release: () => void }> {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(SEARCH_PATH, async (route) => {
    if (isUnfiltered(route.request().url())) await held;
    await route.continue();
  });
  return { release: () => { release(); } };
}

test.describe('marketplace search · a slow earlier response must not overwrite a newer one (F-F-6)', () => {
  let seed: BaseSeed | undefined;

  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('typing a query while the full listing is still in flight still shows the query’s results',
    async ({ adminPage }) => {
      const { release } = await holdUnfilteredSearch(adminPage);
      await gotoAdminSection(adminPage, 'skills');
      await adminPage.waitForURL('**/admin/skills');
      await adminPage.getByTestId('skills-tab-marketplace').click();

      // 不等第一发回来就打字 —— 真人就是这么用的：面还在转，他已经知道自己要搜什么。
      await adminPage.getByTestId('marketplace-search').fill(TARGET);

      // 目标卡要出现……
      await expect(
        adminPage.getByTestId(`market-skill-${TARGET}`),
        'the query’s own result must be on screen',
      ).toBeVisible({ timeout: 20_000 });

      // 过滤之后屏幕上有几张，就地记下来。**不写死数字** —— 搜一个词命中几张是搜索的事，
      // 这条用例问的是「旧回包会不会改变屏幕」，那就拿改变前后去比。
      const filteredCount = await adminPage.locator(ANY_CARD).count();
      expect(filteredCount, 'the query narrowed the grid at all').toBeLessThan(FULL_LISTING_MIN);

      // 然后把扣住的那一发放出来，**等它真的回到浏览器**，再看屏幕。
      // 「旧回包已经到了」于是是事实，不是等够了几秒的猜测。
      const stale = adminPage.waitForResponse(
        (r) => r.url().includes('/marketplace/search') && isUnfiltered(r.url()),
      );
      release();
      await stale;

      await expect(
        adminPage.locator(ANY_CARD),
        'the stale unfiltered listing must not change what the query put on screen',
      ).toHaveCount(filteredCount);
      await expect(adminPage.getByTestId(`market-skill-${TARGET}`)).toBeVisible();
    });
});
