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

// ───────────────────────────────────────────────────────────────────────────
// F-N-3：上面那条守卫**停在门口**。它读两块牌子就收工，从没推开任何一扇门 ——
// 于是牌子改成 "landing page" / "custom pages" 之后，**门后那两个标题仍是 `page` / `pages`**，
// 而它一直绿着。owner 是点进去的：点完之后屏幕上最大的那个词才是他读到的东西。
//
// 判据：点哪条牌子，落地页的大标题就得说出那块牌子上的词 —— 全 nav 一条不漏，
// 不是只钉住这两条（同一个错今天已经在四个地方各犯一次：一条经验只扫到了它出生的那个字段）。
const NAV_ENTRIES: readonly { slug: string; label: string }[] = [
  { slug: 'dashboard', label: 'dashboard' },
  { slug: 'raw', label: 'raw' },
  { slug: 'wiki', label: 'wiki' },
  { slug: 'subjectivity', label: 'subjectivity' },
  { slug: 'writings', label: 'writings' },
  { slug: 'output', label: 'outputs' },
  { slug: 'custom-pages', label: 'custom pages' },
  { slug: 'conversations', label: 'conversations' },
  { slug: 'codes', label: 'codes' },
  { slug: 'roles', label: 'roles' },
  { slug: 'prompts', label: 'prompts' },
  { slug: 'requests', label: 'requests' },
  { slug: 'preview', label: 'preview' },
  { slug: 'sources', label: 'sources' },
  { slug: 'listings', label: 'listings' },
  { slug: 'drafts', label: 'drafts' },
  { slug: 'applications', label: 'applications' },
  { slug: 'skills', label: 'skills' },
  { slug: 'connectors', label: 'connectors' },
  { slug: 'api-mcp', label: 'api · mcp' },
  { slug: 'obsidian', label: 'obsidian' },
  { slug: 'page', label: 'landing page' },
  { slug: 'seo', label: 'seo' },
  { slug: 'ip-bans', label: 'ip bans' },
  { slug: 'account', label: 'account' },
  { slug: 'system', label: 'system' },
];

test.describe('admin · the destination titles itself with the label you clicked', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('every nav entry lands on a section whose heading is that entry’s label',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      const mismatches: string[] = [];
      let previous = '';

      for (const entry of NAV_ENTRIES) {
        const nav = page.getByTestId(`admin-nav-${entry.slug}`);
        await expect(nav, `nav entry ${entry.slug} must exist`).toBeVisible();
        // 牌子上的字以屏幕为准（表里那份是我抄的，抄错了就该在这里露馅）。
        expect(
          (await nav.innerText()).trim(),
          `the nav label for ${entry.slug} moved — update this table`,
        ).toBe(entry.label);

        await nav.click();
        const title = page.getByTestId('section-title');
        await expect(title, `a heading must render after clicking "${entry.label}"`)
          .toBeVisible({ timeout: 15_000 });
        // 换节是客户端跳转：等到标题不再是上一节那句话，再取值（不然读到的是残影）。
        await expect.poll(
          async () => (await title.innerText()).trim(),
          { message: `heading after clicking "${entry.label}"`, timeout: 15_000 },
        ).not.toBe(previous);
        const heading = (await title.innerText()).trim();
        previous = heading;
        if (heading !== entry.label) mismatches.push(`"${entry.label}" → "${heading}"`);
      }

      expect(
        mismatches,
        `an owner navigates by clicking: the biggest word on the destination must be the word on the sign.\n`
        + `these say something else: ${mismatches.join(' · ')}`,
      ).toEqual([]);
    });
});
