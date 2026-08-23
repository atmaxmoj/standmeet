// custom-page.spec.ts —— owner 用 MCP 写自定义 React 页面，访客通过
// /<handle>/p/<slug> 看到 vite build 出的页面。
//
// 用户故事：
//   alice 跟自己 AI 客户端聊"给我建一个 /showcase 页面"。AI 走 MCP 调
//   custom_page.create('showcase') → write_file('App.tsx', ...) → build →
//   poll get_build → promote_to_live。一个访客打开 /alice/p/showcase 就看到
//   vite build 出来的 React 页面里的内容；rollback 走默认（404 no live）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto, gotoAdminSection, reloadAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SLUG = 'showcase';
const PAGE_TITLE = 'Alice thinks out loud';
const HELLO_MARKER = 'STANDMEET_CUSTOM_PAGE_HELLO';
const OWNER_APP = `
import React from 'react';

export default function App() {
  return (
    <main data-testid="custom-page">
      <h1>${PAGE_TITLE}</h1>
      <p>${HELLO_MARKER}</p>
    </main>
  );
}
`.trim();

interface BuildPayload {
  build_id: string;
  page_id: string;
  status: string;
  output_path?: string;
  error_message?: string;
}

interface PagePayload {
  id: string;
  slug: string;
  title: string;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner publishes custom React page; visitor lands on it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('MCP create + write_file + build + promote_to_live → visitor sees React content',
    async ({ playwright, adminPage: page }) => {
      const request = await playwright.request.newContext();
      const { token, sid } = await mcpSetup(request);
      await ownerPublishesCustomPage(request, token, sid);
      await visitorSeesPublishedContent(page);
      await ownerRollsBackToDefault(request, token, sid);
      await visitorSeesNotFoundAfterRollback(page);
      await request.dispose();
    });

  // F-N-1: the section header must NOT present a dead "+ new page" button. Page creation is
  // MCP-driven (custom_page.create/.build/.promote_to_live) — the button had no onClick and did
  // nothing on click. Guard: the affordance is absent and the MCP direction is what's shown.
  // F-N-1 原本断的是「没有 + new page 这个空转的入口」—— 那时面板确实建不了页，所以
  // 摆一个按钮就是骗人。**现在它建得了**（写这一组不再只在 MCP 上），于是同一条规矩
  // 换了个断法：入口要在，而且**要真的接着东西**。
  //
  // 「按钮不该存在」和「按钮该存在且能用」是同一条规矩在两种世界下的样子；
  // 留着旧断言的话，它会在能力补上之后反过来拦住正确的产品。
  test('the authoring affordance exists and is wired (F-N-1, in the world where it works)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'custom-pages');
      await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
      await expect(page.getByTestId('custom-page-source')).toBeVisible();
      await expect(page.getByTestId('custom-page-publish')).toBeVisible();
      // 空 slug 时禁用 —— 那不是「死按钮」，那是它说得出自己现在还不能做什么。
      await expect(page.getByTestId('custom-page-publish')).toBeDisabled();
      await page.getByTestId('custom-page-slug').fill('from-the-panel');
      await expect(page.getByTestId('custom-page-publish')).toBeEnabled();
    });

  // F-P-2 —— **改一版再发一次**是这一屏最常做的事，不是边角情况。
  //
  // 上一版把「建」写死在发布序列的第一步，于是第二次发同一个 slug 撞 409，整条序列在那里
  // 停住：源码没写上去、构建没跑、线上还是旧的。owner 手上只有一个按钮，而这个按钮
  // 对一个已经存在的页面**永远不工作**。
  //
  // 断的是**第二版真的上线了**，不是「没报错」：报没报错跟页面换没换是两件事。
  test('publishing the same slug again ships the new source (F-P-2)',
    async ({ adminPage: page }) => {
      // 两次真构建，沙箱一次只建一个 —— 默认 30s 的用例预算会在第一次的轮询中途断掉，
      // 而那个红读起来像「第二次没发出去」，其实是排队被截断（[[red-in-the-wrong-place]]）。
      test.setTimeout(300_000);
      await publishFromPanel(page, 'twice-over', markerApp('FIRST_CUT'));
      await expectServed(page, 'twice-over', 'FIRST_CUT');

      await publishFromPanel(page, 'twice-over', markerApp('SECOND_CUT'));
      await expectServed(page, 'twice-over', 'SECOND_CUT');
    });

  // F-P-4 —— **发得出去就得撤得回来**。
  //
  // 「owner 在 admin 撤了，访客就访问不到」是这一族的规矩之一，而上一版这一屏只有
  // 「看线上」一个动作：撤下只在 MCP 上，于是 owner 要把自己刚发的东西拿下来，
  // 得另开一个 Claude 会话。判据在**访客那一侧** —— 面板说撤了不算数。
  test('the panel can take a page down again, and the visitor loses it (F-P-4)',
    async ({ adminPage: page }) => {
      test.setTimeout(300_000);
      await publishFromPanel(page, 'withdrawn', markerApp('STILL_UP'));
      await expectServed(page, 'withdrawn', 'STILL_UP');

      await reloadAdminSection(page, 'custom-pages');
      await page.getByTestId('custom-page-takedown-withdrawn').click();

      await expect.poll(async () => {
        const after = await page.request.get('/api/v1/custom-pages/withdrawn');
        return after.status();
      }, { message: 'a page taken down in the panel stops serving' }).toBeGreaterThanOrEqual(400);
    });
});

function markerApp(marker: string): string {
  return `export default function App() {\n  return <main><h1>${marker}</h1></main>;\n}`;
}

// publishFromPanel —— 填 slug、粘源码、点发布，等构建走到终态。**只等终态**：
// 断「还在跑」对任何实现都成立。
async function publishFromPanel(page: Page, slug: string, source: string): Promise<void> {
  // 每次**整页回**面板 —— 上一趟看完线上页之后浏览器停在 `/p/<slug>`，那上面没有侧栏，
  // 点导航的 gotoAdminSection 到不了；红会落在跟这条 check 无关的地方。
  await reloadAdminSection(page, 'custom-pages');
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  await page.getByTestId('custom-page-slug').fill(slug);
  await page.getByTestId('custom-page-source').fill(source);
  await page.getByTestId('custom-page-publish').click();
  // 沙箱一次只建一个，这一族里别的用例也在建 —— 预算给的是排队。
  await expect(page.getByTestId('custom-page-build-status'))
    .toHaveText(/built/i, { timeout: 180_000 });
}

async function expectServed(page: Page, slug: string, marker: string): Promise<void> {
  const served = await page.request.get(`/api/v1/custom-pages/${slug}`);
  expect(served.status(), `/p/${slug} is serving`).toBe(200);
  const assets = await page.request.get(`/p/${slug}`);
  expect(await assets.text(), `the live page carries ${marker}`).toContain('<div id="root">');
  await goto(page, `/p/${slug}`);
  await expect(page.getByRole('heading', { name: marker })).toBeVisible({ timeout: 20_000 });
}

async function mcpSetup(
  request: APIRequestContext,
): Promise<{ token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'custom-page-test');
  const sid = await initMCP(request, token);
  return { token, sid };
}

async function ownerPublishesCustomPage(
  request: APIRequestContext, token: string, sid: string,
): Promise<BuildPayload> {
  await callTool<PagePayload>(request, token, sid, 'custom_page.create', {
    slug: SLUG, title: PAGE_TITLE,
  });
  const writeResult = await callTool<BuildPayload>(
    request, token, sid, 'custom_page.write_file',
    { slug: SLUG, path: 'App.tsx', content: OWNER_APP },
  );
  const built = await waitForBuild(request, token, sid, writeResult.build_id);
  expect(built.status).toBe('built');
  await callTool<PagePayload>(request, token, sid, 'custom_page.promote_to_live', {
    slug: SLUG, build_id: built.build_id,
  });
  return built;
}

async function waitForBuild(
  request: APIRequestContext, token: string, sid: string, buildID: string,
): Promise<BuildPayload> {
  // expect.poll 是 playwright 内建的"retry until predicate true"，比手卷
  // setTimeout 循环可观察 + 走 spec.timeout，符合 eslint no-sleep 规则。
  let last: BuildPayload = { build_id: buildID, page_id: '', status: 'pending' };
  await expect.poll(
    async () => {
      last = await callTool<BuildPayload>(request, token, sid, 'custom_page.get_build', {
        build_id: buildID,
      });
      if (last.status === 'failed') {
        throw new Error(`build failed: ${last.error_message ?? '(no message)'}`);
      }
      return last.status;
    },
    { timeout: 90_000, intervals: [1000, 1000, 1000] },
  ).toBe('built');
  return last;
}

// visitorSeesPublishedContent —— UI-driven 访问 live page：owner 在 admin
// custom-pages list 看到 "view live ↗" 链接（promote_to_live 之后才出现），
// 点击直接跳 /p/<slug>，访客（也就是 admin owner 自己）看到 React 渲染产物。
async function visitorSeesPublishedContent(page: Page): Promise<void> {
  await gotoAdminSection(page, 'custom-pages');
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  await page.locator(`[data-testid="custom-page-row-${SLUG}"]`)
    .getByRole('link', { name: 'view live ↗' })
    .click();
  await page.waitForURL(`**/p/${SLUG}`, { timeout: 10_000 });
  await expect(page.getByTestId('custom-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(HELLO_MARKER, { exact: false })).toBeVisible();
  await expect(page.getByText(PAGE_TITLE, { exact: false })).toBeVisible();
}

async function ownerRollsBackToDefault(
  request: APIRequestContext, token: string, sid: string,
): Promise<void> {
  // rollback：把 live 设回 previous（之前没 live，所以 live 清空）。
  await callTool<PagePayload>(request, token, sid, 'custom_page.rollback', { slug: SLUG });
}

// visitorSeesNotFoundAfterRollback —— rollback 后 admin custom-pages 那条
// row 的 "view live ↗" 链接应该消失（has_live=false）→ 换成 "no live build"
// 文字。UI 表面验证 + 不再用 goto 直接 hit URL。
// custom page (/p/<slug>) 是 standalone React app，没 admin nav。要从这里
// 回 admin 用 `page.goBack()` —— 等价真用户 "看完 live 版本浏览器后退回去"。
async function visitorSeesNotFoundAfterRollback(page: Page): Promise<void> {
  await page.goBack();
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  // rollback 走 MCP，admin store 不知道；reload 让 resource store 重 fetch。
  await page.reload();
  const row = page.locator(`[data-testid="custom-page-row-${SLUG}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText('no live build')).toBeVisible();
  await expect(row.getByRole('link', { name: 'view live ↗' })).toHaveCount(0);
}
