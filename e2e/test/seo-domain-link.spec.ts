// seo-domain-link.spec.ts —— /admin/seo 里 "canonical host" 行那条 "edit on the Domain section →"
// 链接必须落到**真**的 editor，不能 404。
//
// rot-C2（HIGH）：SeoSection.tsx:137 的 `seo-canonical-edit` 链接 href="/admin/domain"，可
// **根本没有 /admin/domain 路由**（app/src/app/admin/ 下没有 domain/ 目录）。真正编辑 public-URL /
// domain 的地方在 /admin/page（PageSection → SiteBlock → PublicURLEditor(`public-url-display` /
// `public-url-editor`) + DomainEditor）。于是 owner 被 SEO section 指去改 canonical host 的唯一入口
// 是个死链，点了就 404。
//
// RED 判据：在 /admin/seo 点 "edit on the Domain section →"，断言落到**真** editor 表面
// （`public-url-display` 可见 / URL 是 /admin/page）。当前 href=/admin/domain → 404，那个 testid
// 永不出现 → RED。断的是 GOOD outcome（到达真 editor），不是 "没报错"。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'seo-domain-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'seodomain',
  fullName: 'Seo Domain Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /seo · the "edit on the Domain section" link must reach a real editor', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('following the canonical-host edit link lands on the real public-URL editor, not a 404',
    linkReachesEditor);
});

// linkReachesEditor —— 点 canonical-host 的 edit 链接，断言到达真 editor 表面。
async function linkReachesEditor({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'seo');
  await expect(page.getByTestId('seo-canonical')).toBeVisible({ timeout: 10_000 });

  const link = page.getByTestId('seo-canonical-edit');
  // 现状 sanity：链接确实渲染了（selector 打错就在这里红，避免静默变绿）。
  await expect(link).toBeVisible();
  // 记录 href 供失败信息用 —— 当前是死链 /admin/domain。
  const href = await link.getAttribute('href');

  // 走链接（真实用户点击 → 全页导航；`<a>` 而非 <Link>）。
  await link.click();

  // GOOD outcome：落到真 public-URL / domain 编辑器。当前 href=/admin/domain → 404，
  // public-url-display 永不出现 → 这里超时 RED。
  await expect(
    page.getByTestId('public-url-display'),
    `the canonical-host edit link (href="${href ?? ''}") did not land on the real editor — `
    + `/admin/domain is not a route; the public-URL / domain editor lives under /admin/page `
    + `(SeoSection.tsx:137 hard-codes a non-existent /admin/domain)`,
  ).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/admin\/page(\/|\?|$)/);
}
