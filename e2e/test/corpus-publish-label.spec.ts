// corpus-publish-label.spec.ts —— 决定「这条对外公不公开」的那个开关,标签得说它是公开开关。
//
// 条目编辑器里没有任何叫 publish 的控件。写 `published` 的是 SEOEditor 里那个 checkbox,
// 而它的标签写着「include in sitemap.xml (let search engines find this)」——说的是一个
// **后果**,不是那个**概念**。取消勾选不是「不让 Google 找到」,是把这个公开页撤下来,
// 顺带把它从首页 pin 列表里静默摘掉(page-corpus-pinning 的不变量)。
//
// owner 已经确认这是**一个**概念(SEO 跟着 published 走),也确认它跟检索无关 —— 检索归
// role 的 corpus glob + citable 管。所以这里不是 schema 问题,是标签问题。
//
// 断的是标签点名那个概念,不是它长什么样。

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'publabel@example.com', password: 'correct-horse-battery-staple',
  handle: 'publabel', fullName: 'Pub Label Owner',
};

const TITLE = 'Publish Label Probe';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('corpus · the publish switch is labelled as a publish switch', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'pub-label-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, { title: TITLE, body: 'a body worth publishing' });
    await request.dispose();
  });

  test('the control that writes `published` names publishing, not the sitemap',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.getByText('edit', { exact: false }).first().click();

      // testid 带 entry id(`wiki-<uuid>-seo-indexed`),所以按后缀选。
      const box = adminPage.locator('[data-testid$="-seo-indexed"]').first();
      await expect(box).toBeVisible();
      // 标签是包着 checkbox 的那个 label。
      const label = (await box.locator('xpath=ancestor::label[1]').innerText()).toLowerCase();

      expect(label, 'the switch must name what it actually decides: whether this is public')
        .toMatch(/publish|public/);
      // 只说 sitemap 就是把一个后果冒充成那个概念 —— 取消勾选会把整个公开页撤掉。
      expect(
        label.includes('sitemap') && !/publish|public/.test(label),
        'the label may mention the sitemap, but not instead of publishing',
      ).toBe(false);
    });
});
