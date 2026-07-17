// corpus-curation.spec.ts —— AI 通过 MCP 推送 raw 进 corpus，owner 在
// admin 里看到。
//
// 用户故事：
//   owner 在 Cursor 跟 AI 聊天，让 AI 把一条 insight 用 raw_dump 推进
//   corpus。然后 owner 打开 /admin/raw 想确认到没到 —— 应当看到那条
//   原文。这是 owner curation loop 的第一步（"我让 AI 写了什么"），
//   后续会在同一页加 promote-to-wiki UI 让 owner 决定要不要
//   保留它。
//
// AI client 这一侧仿真：spec 调 MCP raw_dump，等同于 Cursor / Claude
// Desktop 自动调它。MCP 协议本身就是 owner ingest 的 user surface。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const RAW_BODY = 'I think microservices were Amazon org chart in YAML.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('AI pushes raw insight via MCP; owner sees it in admin', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await aiPushesRaw(request, RAW_BODY);
    await request.dispose();
  });

  test('owner opens /admin/raw and sees the AI-pushed entry',
    async ({ adminPage: page }) => {
      await openRaw(page);
      // 限定在列表里断言，不是"页面上任何角落有这句话"：侧栏的 corpus-constellation 跑马灯也会
      // 显示同一条最近条目，全页 getByText 会同时命中它俩（strict mode violation）。
      // 这条用例要证的是「owner 在 raw 列表里看得到它」，那就在列表里找。
      await expect(page.getByTestId('raw-list')).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByTestId('raw-list').getByText(RAW_BODY, { exact: false }),
      ).toBeVisible();
    });
});

async function aiPushesRaw(request: APIRequestContext, body: string): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'cursor-mbp');
  const sid = await initMCP(request, apiToken);
  await callTool<{ raw_id: string }>(request, apiToken, sid, 'raw_dump', {
    body, source: 'mcp:cursor', tags: ['architecture'],
  });
}

async function openRaw(page: Page): Promise<void> {
  await gotoAdminSection(page, 'raw');
  await page.waitForURL('**/admin/raw', { timeout: 5_000 });
}
