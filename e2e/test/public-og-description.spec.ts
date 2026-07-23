// public-og-description.spec.ts —— 公开根页 `/` 的 `<meta name="description">` 必须反映 owner **真实**的
// 页面内容（hero prose），不是每个 instance 都一样的固定串。
//
// rot-C3：根页的 meta description 现在是 `layout.tsx` 里的硬编码常量
// `'A personal page that argues back.'` —— 根 `page.tsx` 没有 `generateMetadata`，所以这条常量就是
// 每个 instance 的站点根描述，跟 owner 是谁、页面写了什么毫无关系。而 `/admin/seo` 还告诉 owner
// og:description "Uses your page tagline." 让他去 `/admin/page` 改 —— 但根本没有顶层 page `tagline`
// 字段，就算有，描述也不会动（它是那条常量）。真正该驱动描述的字段是 **hero_prose**（owner 在
// `/admin/page` 改，testid `hero-prose`，也正是根页 `Hero` 已经渲染的那段文字）。wiki / output landing
// 页早就 honest 地在 `generateMetadata` 里从真内容派生 description，根页是唯一画常量的那个 surface。
//
// 判据（选 shape (b)：编辑 → 断言，最贴近现有 page-edit.spec 的 round-trip 套路，且单 instance 即可，
// 不必 claim 两个 instance 对比）：在 `/admin/page` 把 hero prose 改成一句独特的话、保存，全量导航到
// `/`，读 `<meta name="description">` 的 content —— 它必须**包含**那句独特的话，且**不是**那条固定常量。
// 现在代码画常量 → 不含独特话 → RED。修好（根页加 generateMetadata 从 hero_prose 派生）后 → GREEN。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'og-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ogowner',
  fullName: 'OG Owner',
};

// 一句独特的 hero prose（< 160 字符，这样即便修复用 hero_prose.slice(0,160) 也仍含前导片段）。
const HERO_PROSE =
  'I turn quiet obsessions into shipped systems — ask me anything about distributed consensus.';
// meta 里必须出现的前导片段（对 .slice(0,160) 之类的修复稳健）。
const PROSE_FRAGMENT = 'I turn quiet obsessions into shipped systems';
// 每个 instance 都一样的硬编码常量 —— meta description 绝不能是它。
const SHIPPED_CONSTANT = 'A personal page that argues back.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('public root · the meta description reflects the owner\'s prose, not a shipped constant', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('edit hero prose in /admin/page ⇒ the public root meta description carries it (not the constant)',
    metaDescriptionFollowsProse);
});

// metaDescriptionFollowsProse —— 改 hero prose、保存、导航到 `/`，断言 `<meta name="description">`
// 反映 owner 的话而非固定常量。
async function metaDescriptionFollowsProse({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'page');
  await editHeroProse(page, HERO_PROSE);

  await goto(page, '/');
  const description = await metaDescription(page);

  expect(
    description,
    `the public root's meta description must carry the owner's hero prose; got ${JSON.stringify(description)} `
    + '— a constant here means layout.tsx\'s hardcoded description is still the site-root description '
    + '(the root page has no generateMetadata deriving it from hero_prose)',
  ).toContain(PROSE_FRAGMENT);
  // guard：明确排除那条每个 instance 都一样的固定串（防止将来又回落成常量）。
  expect(description, 'the meta description must not be the shipped-in constant')
    .not.toContain(SHIPPED_CONSTANT);
}

// editHeroProse —— 与 page-edit.spec 同套路：填 hero-prose textarea、保存、等 saved。
async function editHeroProse(page: Page, prose: string): Promise<void> {
  const textarea = page.getByTestId('hero-prose');
  await expect(textarea).toBeVisible({ timeout: 5_000 });
  await textarea.fill(prose);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 5_000 });
}

// metaDescription —— 读根页 `<head>` 里 `<meta name="description">` 的 content。
async function metaDescription(page: Page): Promise<string> {
  const meta = page.locator('meta[name="description"]');
  await expect(meta).toHaveCount(1, { timeout: 10_000 });
  return (await meta.getAttribute('content')) ?? '';
}
