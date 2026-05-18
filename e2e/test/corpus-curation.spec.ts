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

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '../helper/admin';
import { resetInstance, findSetupToken } from '../helper/docker';
import { callTool, initMCP } from '../helper/mcp';
import { goto } from '../helper/navigate';

const OWNER = {
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sijie',
  fullName: 'Sijie Wang',
};

const RAW_BODY = 'I think microservices were Amazon org chart in YAML.';

test.describe.serial('AI pushes raw insight via MCP; owner sees it in admin', () => {
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
    async ({ page }) => {
      await signInAndOpenRaw(page);
      await expect(page.getByTestId('raw-list')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(RAW_BODY, { exact: false })).toBeVisible();
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

async function signInAndOpenRaw(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL('**/admin/page', { timeout: 10_000 });
  await page.getByTestId('nav-raw').click();
  await page.waitForURL('**/admin/raw', { timeout: 5_000 });
}
