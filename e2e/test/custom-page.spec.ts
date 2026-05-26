// custom-page.spec.ts —— owner 用 MCP 写自定义 React 页面，访客通过
// /<handle>/p/<slug> 看到 vite build 出的页面。
//
// 用户故事：
//   alice 跟自己 AI 客户端聊"给我建一个 /blog 页面"。AI 走 MCP 调
//   custom_page.create('blog') → write_file('App.tsx', ...) → build →
//   poll get_build → promote_to_live。一个访客打开 /alice/p/blog 就看到
//   vite build 出来的 React 页面里的内容；rollback 走默认（404 no live）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SLUG = 'blog';
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

test.describe.serial('owner publishes custom React page; visitor lands on it', () => {
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
});

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
