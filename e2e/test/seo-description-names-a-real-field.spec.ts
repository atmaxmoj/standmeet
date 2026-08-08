// seo-description-names-a-real-field.spec.ts —— "edit it under X" 里的 X 必须真的在那一页上。
//
// /admin/seo 的 og:description 那块写着「Uses your page **tagline**」,底下一个链接指到
// /admin/page。那一页上没有任何叫 tagline 的东西 —— 字段叫 **prose**(hero 段里的
// `prose · 1–3 sentences`),后端字段是 `hero_prose`。owner 照着这句话过去,找不到它说的东西。
//
// 这是 names-that-lie 那一类里最难被断言抓住的一种:两页各自都渲染正常,**只有把两页放在
// 一起读**才看得出来对不上。所以这条用例故意跨两页:在 A 页读出那个名词,到 B 页去找它。
//
// item corpus-render 之外,public-og-description check 2 的 Backing test 一直写着 `gap`。

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'seo-noun@example.com', password: 'correct-horse-battery-staple',
  handle: 'seonoun', fullName: 'Seo Noun Owner',
};

// NOUN —— SEO 那句话该用的名词,也是 page 编辑器上那个字段的标签词。
const NOUN = 'hero prose';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('seo · the og:description copy names a field that exists', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the noun on /admin/seo is findable on the page it sends you to', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'seo');
    const block = adminPage.getByTestId('seo-description');
    await expect(block).toBeVisible();

    const copy = (await block.innerText()).toLowerCase();
    expect(copy, 'the copy must name the field that actually feeds og:description').toContain(NOUN);
    // `tagline` 在整个产品里不存在。留着它,owner 就会去找一个不存在的东西。
    expect(copy, 'no field is called a tagline anywhere in this product').not.toContain('tagline');

    // 跟着它自己的链接走 —— 名词得在落地那一页上找得到。
    await block.getByRole('link').click();
    await adminPage.waitForURL('**/admin/page');
    // 等编辑器真的渲出来再读 —— 落地那一刻 main 里只有标题,读到的是"还没画完",
    // 不是"没有这个词"。
    await expect(adminPage.getByTestId('hero-prose')).toBeVisible();
    const editor = (await adminPage.locator('main').innerText()).toLowerCase();
    expect(editor, 'the noun must be findable on the page the copy sends the owner to')
      .toContain('prose');
  });
});
