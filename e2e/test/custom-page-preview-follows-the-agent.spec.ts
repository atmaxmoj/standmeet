// custom-page-preview-follows-the-agent.spec.ts —— owner 指挥 agent 改页面时，看得见。
//
// 缺陷（owner 自己说的，2026-08-31）："让我有 panel 能看效果，然后我在指挥 agent 改的时候
// 实时能让我看到就好。"
//
// 今天 `/admin/custom-pages` 是**一张表** —— slug、绑了哪些码、有没有 live。一个字都不说
// 这一页长什么样。而真正在写这些页的是 Claude（面板自己的 intro 就写着
// "Owner creates / builds / promotes via MCP"），于是 owner 处在最糟的位置上：
// 他在下指令，而反馈只有一行"has_live: true"。
//
// 还有一层：`/p/{slug}` **只服务 live build**（`ResolveLiveBuild`）。所以 Claude 刚建好、
// 还没 promote 的那一版，owner 根本没有任何地方看得到 —— 而那恰恰是他要看的那一版
// （看完才决定要不要上线）。预览必须看 **staging**。
//
// 判据三条，第三条是这件事的全部意义：
//   ① 面板上真的渲出这一页（不是一行状态字）
//   ② 看的是 **staging** —— Claude 建好还没上线的那一版
//   ③ Claude 再改一次，owner **不刷新页面**就看见新的
//
// ③ 不能用"重新打开面板然后断新内容"来糊弄：那测的是"刷新之后是对的"，
// 而 owner 的抱怨正是"我得自己去刷"。所以这条用例从头到尾不 reload。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'previewer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'previewer',
  fullName: 'Pia Previewer',
};
const SLUG = 'press-kit';

// pageSource —— agent 写进去的那一版。marker 是这一版的唯一标记：
// 断"变了"必须有只属于这一次的东西，否则两版长得一样，断言永远绿
// （[[widened-response-reaims-assertions]]）。
function pageSource(marker: string): string {
  return `export default function App() {
  return <main><h1 data-sm="headline">${marker}</h1></main>;
}`;
}

interface Agent { request: Parameters<typeof callTool>[0]; token: string; sid: string }

// agentBuilds —— 走 **MCP**，不是 admin REST：owner 说的"指挥 agent 改"就是这条路，
// 而面板要跟上的正是它。用 REST 驱动的话测的是另一条路（[[which-path-is-the-green-on]]）。
async function agentBuilds(a: Agent, marker: string): Promise<void> {
  await callTool(a.request, a.token, a.sid, 'custom_page.write_file', {
    slug: SLUG, path: 'App.tsx', content: pageSource(marker),
  });
  await callTool(a.request, a.token, a.sid, 'custom_page.build', { slug: SLUG });
}

// headlineIn —— 预览 iframe 里那一行字。
function headlineIn(page: Page) {
  return page.frameLocator(`[data-testid="custom-page-preview-${SLUG}"]`)
    .locator('[data-sm="headline"]');
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// 真构建要几十秒，而这条用例里要构建两次。
test.describe.configure({ timeout: 600_000 });
test.describe('custom pages · the panel shows what the agent just built, without a reload', () => {
  let agent: Agent;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'preview-spec');
    agent = { request, token, sid: await initMCP(request, token) };
    await callTool(request, token, agent.sid, 'custom_page.create', {
      slug: SLUG, title: 'Press kit',
    });
  });

  test('the panel renders the staging build, and follows the next one live',
    async ({ adminPage: page }) => {
      // ── agent 建第一版 ──────────────────────────────────────────
      await agentBuilds(agent, 'FIRST-VERSION');

      await gotoAdminSection(page, 'custom-pages');
      await page.waitForURL('**/admin/custom-pages', { timeout: 5_000 });

      // ① + ② 面板真的渲出这一页，而且看的是 **staging**（还没 promote 过 live）。
      await expect(headlineIn(page), '面板上看不到这一页长什么样')
        .toHaveText('FIRST-VERSION', { timeout: 300_000 });

      // ── owner 不动。agent 再改一次。 ────────────────────────────
      await agentBuilds(agent, 'SECOND-VERSION');

      // ③ 这条是这件事的全部意义：**没有 reload**，预览自己跟上。
      await expect(headlineIn(page), 'owner 得自己刷新才看得到 = 没解决他说的那个问题')
        .toHaveText('SECOND-VERSION', { timeout: 300_000 });
    });
});
