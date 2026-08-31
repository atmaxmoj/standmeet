// custom-page-starter-actually-chats.spec.ts —— 面板给的起手模板必须是**能跑的东西**。
//
// 缺陷（2026-08-30，owner 自己在产品里发现）："我想引用我们的 chat 功能，我完全不知道
// 写什么。" 面板上只有一个 slug 框 + 一个 textarea，起手模板是字面意义上的
// `<main><h1>Hello</h1></main>`。
//
// 而 `builder/vendor/` 里**已经**装好了 `@standmeet/sdk` / `sdk-core` / `agent-core`，
// chat 接得上；`e2e/fixtures/custom-page-rig.ts` 里的 ASK_PAGE 甚至就是一份写好的范例。
// 也就是说：这份知识在仓库里是有的，只是**不在 owner 的屏幕上**。
// 而且 `builder/template/src/main.tsx` 不包 provider，owner 必须自己写
// `<StandMeetProvider>` —— 这件事更是一个字都没说。
//
// 判据：把面板**原样给出的**模板发布出去，那一页必须真的能问答。
//   - 不跟 ASK_PAGE 比对：那是同一个事实的第二份拷贝，会漂移。
//   - 不断"构建成功"：`<h1>Hello</h1>` 也构建成功。构建成功不是"教会了 owner"。
//   - 走 UI 拿模板，不从 app 源码 import：owner 读到的就是屏幕上那份，
//     测试也只该读那一份。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto, gotoAdminSection } from '@/fixtures/navigate';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'starter@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'starter',
  fullName: 'Stella Starter',
};
const SLUG = 'starter-page';
const ANSWER = 'The starter template answered from the corpus.';

const sm = (page: Page, name: string) => page.locator(`[data-sm="${name}"]`);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// 沙箱一次只建一个，真构建要几十秒到几分钟 —— 用例上限得跟着，
// 断言上的 timeout 管不住整条用例（默认 30s 会先到）。
test.describe.configure({ timeout: 300_000 });
test.describe('custom pages · the starter the panel hands you is a working chat page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('publishing the untouched starter produces a page a reader can ask on',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'custom-pages');
      await page.waitForURL('**/admin/custom-pages', { timeout: 5_000 });

      // 面板必须**先**告诉 owner 能 import 什么。它今天什么都不说。
      const help = page.getByTestId('custom-page-imports');
      await expect(help).toContainText('@standmeet/sdk');
      await expect(help).toContainText('useChatSession');

      // 一个字不改，直接发布面板给的那份。
      await page.getByTestId('custom-page-slug').fill(SLUG);
      await page.getByTestId('custom-page-publish').click();
      await expect(page.getByTestId('custom-page-build-status'))
        .toHaveText(/built/i, { timeout: 180_000 });

      // 读者那一侧：这一页得真的能问答。
      const request = await playwright.request.newContext();
      await loginAPI(request, OWNER.email, OWNER.password);
      // 返回的 tag 就是这条注册的键 —— 提问里必须带上它，否则 mock 不认得这一轮，
      // 回的是它收到的 system prompt（[[mock-llm-pure-registration-kv]]）。
      const tag = await scriptMockReplyText(request, ANSWER);

      const reader = await (await playwright.chromium.launch()).newPage();
      await goto(reader, `/p/${SLUG}`);

      const box = sm(reader, 'ask');
      await box.waitFor({ state: 'visible', timeout: 20_000 });
      await box.fill(`what do you write about? ${tag}`);
      await box.press('Enter');
      await expect(sm(reader, 'answer')).toContainText(ANSWER, { timeout: 30_000 });

      await reader.close();
      await request.dispose();
    });
});
