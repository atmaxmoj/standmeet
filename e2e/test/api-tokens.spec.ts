// api-tokens.spec.ts —— owner 在 admin 里发 API token，然后用它从 MCP
// client（仿真 Claude Desktop / Cursor）调进来。
//
// 用户故事：
//   owner 想把 MCP server 连上自己的 AI client。Admin /api-mcp 页里点
//   "create"，拿到一次性 plaintext token，复制到 client 配置。client
//   就能调 me() 拿到自己 owner 信息。delete 之后旧 token 失效。

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim } from '../helper/admin';
import { resetInstance, findSetupToken } from '../helper/docker';
import { callTool, initMCP } from '../helper/mcp';
import { goto } from '../helper/navigate';

const OWNER = {
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sijie',
  fullName: 'Sijie Wang',
};

test.describe.serial('owner mints an API token in admin and an MCP client uses it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('admin creates token → mcp client calls me() → owner profile returned',
    async ({ page, request }) => {
      await signInAndOpenAPIMCP(page);
      const plaintext = await createTokenInUI(page, 'cursor-mbp');
      const me = await callMeAsMCPClient(request, plaintext);
      expect(me.email).toBe(OWNER.email);
      expect(me.handle).toBe(OWNER.handle);
    });
});

async function signInAndOpenAPIMCP(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL('**/admin/page', { timeout: 10_000 });
  await page.getByTestId('nav-api-mcp').click();
  await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });
}

async function createTokenInUI(page: Page, name: string): Promise<string> {
  await page.getByTestId('token-name').fill(name);
  await page.getByTestId('token-create').click();
  const plaintextLocator = page.getByTestId('token-plaintext');
  await expect(plaintextLocator).toBeVisible({ timeout: 5_000 });
  const plaintext = (await plaintextLocator.textContent())?.trim() ?? '';
  expect(plaintext).toMatch(/^smk_/);
  return plaintext;
}

async function callMeAsMCPClient(
  request: APIRequestContext,
  apiToken: string,
): Promise<{ email: string; handle: string }> {
  const sid = await initMCP(request, apiToken);
  return await callTool<{ email: string; handle: string }>(
    request, apiToken, sid, 'me', {},
  );
}
