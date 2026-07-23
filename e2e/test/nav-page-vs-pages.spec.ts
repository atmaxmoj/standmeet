// nav-page-vs-pages.spec.ts —— admin 侧栏两个 "page(s)" 入口必须**可区分**，不是同一个词的两块牌子。
//
// rot-D2：slug `page` 顶着 "public page"（settings 组）→ PageSection，就是那唯一一张公开**落地页**；
// slug `custom-pages` 顶着 "pages"（corpus 组）→ CustomPagesSection，是 MCP 建的、挂在 /p/{slug} 的
// **微站集合**。两块牌子读起来就是同一个词 —— owner 分不清哪扇门是哪扇。一个 label 得说清它开的是什么；
// "public page" / "pages" 谁也没说清。
//
// 判据（断好结果，不断"没红字"）：区分性 token 必须落地 —— 落地页那条含 "landing"，微站那条含 "custom"；
// 二者都不再是光秃秃的 "page"/"pages"。今天的 "public page"/"pages" 上 RED，改名后 GREEN。
// nav link 文本挂在 data-testid="admin-nav-<slug>" 上（见 AdminSidebar SidebarItem）。

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';

const OWNER = {
  email: 'nav-labels@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'navlabels',
  fullName: 'Nav Labels Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sidebar · the landing-page and custom-pages entries are not confusable', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  // adminPage fixture 已落 /admin 并登录，侧栏（admin-nav-page）可见 —— 直接读两条 nav 文本。
  test('the single-landing-page entry and the microsites entry carry disambiguated labels',
    async ({ adminPage: page }) => {
      const pageNav = page.getByTestId('admin-nav-page');
      const customNav = page.getByTestId('admin-nav-custom-pages');
      await expect(pageNav).toBeVisible();
      await expect(customNav).toBeVisible();

      const pageLabel = (await pageNav.innerText()).trim();
      const customLabel = (await customNav.innerText()).trim();

      // 落地页那条必须带上区分 token "landing"（今天是 "public page" → RED）。
      expect(
        /landing/i.test(pageLabel),
        `the single public-page entry must name itself the "landing" page, not a bare "page"; got "${pageLabel}"`,
      ).toBe(true);
      // 微站那条必须带上区分 token "custom"（今天是 "pages" → RED）。
      expect(
        /custom/i.test(customLabel),
        `the microsites entry must name itself "custom" pages, not a bare "pages"; got "${customLabel}"`,
      ).toBe(true);

      // 兜底：两条 label 归一化后不能撞成同一个 "page"/"pages" 词 —— 两块名副其实的牌子，不是一块的复制。
      expect(
        normalize(pageLabel) !== normalize(customLabel),
        `the two entries must not collapse to the same word; both read "${pageLabel}" ≈ "${customLabel}"`,
      ).toBe(true);
    });
});

// normalize —— 抹掉大小写、空格与结尾复数 s，把 "public page"/"pages" 这类拉到同一底，
// 用来证明两条 label 不是同一个词的两种写法。
function normalize(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').replace(/s\b/g, '').trim();
}
