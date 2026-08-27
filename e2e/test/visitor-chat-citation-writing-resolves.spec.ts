// visitor-chat-citation-writing-resolves.spec.ts —— 引用一篇 **writing** 时，
// 那条链接必须**真的打得开**。
//
// 现场（prod，sijie.xyz）：答案下面的引用点开是
//   sijie.xyz/writing/writings/the-business-model-wedge  →  404
// 而那篇是这台实例当时**唯一**一篇公开 writing —— 整个公开阅读面的入口是坏的。
//
// 成因：两处渲染各自把地址拼成 `/${c.genre}/${c.path}`，**把体裁名当成了路由名**。
// 体裁是单数 `writing`，路由是复数 `/writings/[slug]`；而那条 writing 的语料 path
// 本身又带 `writings/` 前缀（vault 里就有这个目录），于是叠成两段。
//
// 为什么以前没被抓到：这一族断言只覆盖了 wiki
// （`visitor-chat-citation-multi.spec.ts` 断言 `/wiki/<path>`）——
// 而 wiki 恰好是那个错公式**碰巧对**的那种体裁。三种体裁里两种侥幸成立，
// 于是测试全绿、缺陷只出现在第三种上（[[all-tests-are-failure-path]] 的同类：
// 覆盖只落在不会暴露问题的那一格）。
//
// 判据**不是字符串相等**，是「**点**它，然后人看到那篇文章」。断 href 等于某个字面量的话，
// 我把公式改成另一个一致的错法它照样绿（[[assertion-that-cannot-fail]]）；而读出 href
// 自己 goto，绕开的正是访客真正做的那个动作（这条引用是 `target="_blank"`，真点开新标签页）。
//
// RED（修复前）：点开的那个新标签页是 Next 的 404 —— 地址是 `/writing/writings/<slug>`。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'citation-writing@example.com',
  password: 'a-citation-that-cannot-be-followed-is-not-a-citation-1',
  handle: 'citeowner',
  fullName: 'Cite Owner',
};
const CODE = 'CITEWRITE-01';

const SLUG = 'the-business-model-wedge';
// 语料树里的位置带 `writings/` 前缀 —— 跟 vault 一样。**这一段正是叠出 404 的那一段**，
// 少了它这条用例驱不到那个缺陷。
const CORPUS_PATH = `writings/${SLUG}`;
const TITLE = 'Attack the Business Model, Not the Feature List';

test.describe('引用一篇 writing 时，那条链接打得开', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    await initOwner(playwright);
  });

  test('点引用落在那篇文章上，不是 404', async ({ page }) => {
    test.setTimeout(120_000);
    await enterCodeSession(page, CODE);

    const tag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: CORPUS_PATH },
    });
    const input = page.getByTestId('chat-input-field');
    await input.fill(`what do you think about competing on features?${tag}`);
    await input.press('Enter');

    // references 默认是折叠的 —— 不先展开的话，红会停在「引用行不可见」上，
    // 那是抽屉的事，不是这条用例要驱的那个缺陷（[[red-in-the-wrong-place]]）。
    const refs = page.locator('[data-testid="citations"]', {
      has: page.locator(`[data-citation-path="${CORPUS_PATH}"]`),
    });
    await expect(refs, '这一轮引了那篇 writing').toBeVisible({ timeout: 30_000 });
    await refs.locator('summary').first().click();

    const row = refs.locator('[data-testid="citation-row"]').first();
    await expect(row, '引用行展开后看得见').toBeVisible({ timeout: 15_000 });

    // **点它**，不是读出 href 自己跳过去。
    //
    // 后者绕开了访客真正做的那个动作：这条引用带 `target="_blank"`，真点是开一个新标签页，
    // 而"读 href + goto"从来不会驱到那条路 —— 链接被别的元素盖住、handler 吃掉默认行为、
    // 新窗口被拦，三种情况下它都照样绿。判据得是**点完之后人看到了什么**。
    const [opened] = await Promise.all([
      page.waitForEvent('popup', { timeout: 15_000 }),
      row.click(),
    ]);
    await opened.waitForLoadState('domcontentloaded');

    await expect(opened.locator('body'), '点开落在那篇文章上')
      .toContainText(TITLE, { timeout: 15_000 });
    // 判负的那一半：先钉住上面那条（正文真的在），这一条才不是在空页上恒真。
    await expect(opened.locator('body'), '不是 Next 的 404 页')
      .not.toContainText('This page could not be found');
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'cite-writing-seed');
  const sid = await initMCP(request, apiToken);
  await callTool(request, apiToken, sid, 'writing_create', {
    slug: SLUG,
    title: TITLE,
    excerpt: 'Feature lists are downstream of the model that pays for them.',
    body_md: 'A feature list is the surface. The business model is what decides '
      + 'which features can exist at all, and it is the thing a competitor cannot copy cheaply.',
    cover_headline: 'wedge.', cover_hue: 'amber',
    tags: ['strategy'], publish: true,
  });
  await createCode(request, csrf, { code: CODE, label: 'citewrite' });
  await request.dispose();
}
