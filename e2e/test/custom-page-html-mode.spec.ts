// custom-page-html-mode.spec.ts —— 写一页不该被迫先学 React。
//
// 缺陷（2026-08-30，owner 问"能不能不是纯 react 代码，有什么简单点的么"）：
// 今天必须写 React，而这**不是管线的要求** —— `builder/runner.mjs` 无条件写
// `src/owner-entry.tsx` 然后跑 vite，要求 React 的是那个 entry shim。
//
// 而 `sdk/packages/embed` 早就注册了 `<standmeet-chat base-url mode code>`，零 React、
// 能跑。它只是**没被 vendor 进 builder**，也没有任何路由在服务它 —— 我探过线上的
// `/embed.js` 和 `/sdk/embed.js`，都是 404。CLAUDE.md 里承诺的"单个 `<script>` 标签
// drop-in"目前是张空头支票。
//
// 两条判据，第二条同等重要：
//   1. HTML 源码能发布，且 `<standmeet-chat>` 真的升级成一个能问答的组件
//      （断"元素在 DOM 里"不够 —— 自定义元素没注册时它也在 DOM 里，只是个哑标签）。
//   2. **React 那条路一个字都没少。** 修"提供了做不到的动作"时最容易顺手造出
//      "拿掉了做得到的动作"，而那种失败 CI 全绿、闸门不响。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/custom-page-rig';
import { goto } from '@/fixtures/navigate';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'htmlmode@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'htmlmode',
  fullName: 'Hana HTML',
};

// owner 写的全部东西 —— 没有 import，没有 JSX，没有 provider。
const HTML_PAGE = `<h1>Press kit</h1>
<p>Ask me anything about the work.</p>
<standmeet-chat mode="public"></standmeet-chat>`;

const REACT_PAGE = `
import { StandMeetProvider, useChatSession } from "@standmeet/sdk";
function Ask() {
  const chat = useChatSession({ mode: "public", visitor_name: "reader" });
  const answer = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return <div data-sm="answer">{answer ? answer.text : "ready"}</div>;
}
export default function App() {
  return <StandMeetProvider baseURL=""><Ask /></StandMeetProvider>;
}`;

const HTML_ANSWER = 'Answered from inside a plain HTML page.';

const sm = (page: Page, name: string) => page.locator(`[data-sm="${name}"]`);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('custom pages · plain HTML is a first-class way to write a page', () => {
  let csrf = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
    await request.dispose();
  });

  test('an HTML page with <standmeet-chat> publishes and actually answers',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await publishPage(request, csrf, 'press-kit', HTML_PAGE);
      // tag 是这条注册的键 —— 提问里得带上（[[mock-llm-pure-registration-kv]]）。
      const tag = await scriptMockReplyText(request, HTML_ANSWER);

      const reader = await (await playwright.chromium.launch()).newPage();
      await goto(reader, '/p/press-kit');

      // owner 写的那两行普通 HTML 得原样在。
      await expect(reader.getByRole('heading', { name: 'Press kit' })).toBeVisible();

      // 自定义元素必须**升级**了 —— 没注册的话它照样在 DOM 里，只是个哑标签。
      // 所以断的是它长出了内部结构，而不是断标签存在。
      const el = reader.locator('standmeet-chat');
      await expect(el).toBeVisible({ timeout: 20_000 });
      const upgraded = await el.evaluate(
        (node) => node.shadowRoot !== null || node.childElementCount > 0,
      );
      expect(upgraded, '<standmeet-chat> never upgraded — the embed bundle did not load').toBe(true);

      // 而且它能真的问答 —— 升级了但问不出答案，等于换了个更好看的哑标签。
      const box = el.locator('input, textarea').first();
      await box.waitFor({ state: 'visible', timeout: 20_000 });
      await box.fill(`what is this? ${tag}`);
      await box.press('Enter');
      await expect(el).toContainText(HTML_ANSWER, { timeout: 30_000 });

      await reader.close();
      await request.dispose();
    });

  test('the React path is untouched: adding HTML mode must not remove it',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await publishPage(request, csrf, 'react-still-works', REACT_PAGE);

      const reader = await (await playwright.chromium.launch()).newPage();
      await goto(reader, '/p/react-still-works');
      await expect(sm(reader, 'answer')).toBeVisible({ timeout: 20_000 });

      await reader.close();
      await request.dispose();
    });
});
