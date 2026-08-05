// external-mcp-sse-transport.spec.ts —— owner 粘一个**老式 HTTP+SSE** 的 MCP 地址,也连得上。
//
// MCP 规范里 HTTP+SSE 是旧传输(2024-11-05),streamable HTTP 在 2025-03-26 取代了它。所以
// 现在**新**的远程 server 大多没问题 —— 但不少服务还挂着 `/sse` 老端点没迁,owner 手里就是
// 那么一个地址。在此之前 `mcpclient.Dial` 只会 `NewStreamableHttpClient`,全仓没有一行 SSE:
// 粘老地址 → 拨不通 → 那台 server 的工具**静默消失**,界面不说为什么。
//
// **owner 不该手选传输**:他手里只有一个地址,哪种传输是**对面的属性**,该由我们探。
// 所以这里没有"传输类型"这个字段 —— 同一个注册表单、同一个 URL 字段,连上就是连上。
//
// 对面用的是 mcp-server-mock 的 `/sse`(同一个 server 的另一张脸,独立路径,不影响别的 spec)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { enterCodeSession, gotoAdminSection } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'ssemcp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ssemcp',
  fullName: 'SSE MCP Owner',
};

// 三个入口,同一个 mock server:
//   /sse       老式 HTTP+SSE(本 spec 的主角)
//   /mcp       streamable HTTP(回归对照)
//   /mcp-auth  要认证的那个(external-mcp-auth-header 用)
const SSE_URL = 'http://mcp-server-mock:9100/sse';
const STREAMABLE_URL = 'http://mcp-server-mock:9100/mcp';
const AUTHED_SSE_URL = 'http://mcp-server-mock:9100/sse';

const EXT_MARKER = '[EXT-MCP-MARKER]';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('owner 粘一个 SSE 地址,照样连得上', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('SSE-only 的 server:工具能调,回包落进访客的答案', async ({ adminPage, browser }) => {
    await addServer(adminPage, 'ssetools', SSE_URL);
    await attachToCode(adminPage, 'ssetools', 'SSE-OK', 'sserole');

    const answer = await askVisitorToCallExtTool(browser, 'SSE-OK', 'ssetools');
    await expect(
      answer,
      '只会 streamable HTTP 的话这里永远等不到 —— 那台 server 的工具静默消失',
    ).toContainText(EXT_MARKER, { timeout: 20_000 });
  });

  test('streamable HTTP 那条没被降级逻辑碰坏', async ({ adminPage, browser }) => {
    await addServer(adminPage, 'streamtools', STREAMABLE_URL);
    await attachToCode(adminPage, 'streamtools', 'STREAM-OK', 'streamrole');

    const answer = await askVisitorToCallExtTool(browser, 'STREAM-OK', 'streamtools');
    await expect(answer).toContainText(EXT_MARKER, { timeout: 20_000 });
  });

  test('认证头在 SSE 这条路上也带', async ({ adminPage, browser }) => {
    // 老端点上带头:mock 的 /sse 不校验头,所以这条断的是**带着头也仍然连得通**
    // (头被当成 streamable 专属选项传丢的话,SSE 客户端要么报错要么裸连)。
    await addServer(adminPage, 'ssehdr', AUTHED_SSE_URL, {
      name: 'X-Mock-Auth', value: 'mock-secret-token',
    });
    await attachToCode(adminPage, 'ssehdr', 'SSE-HDR', 'ssehdrrole');

    const answer = await askVisitorToCallExtTool(browser, 'SSE-HDR', 'ssehdr');
    await expect(answer).toContainText(EXT_MARKER, { timeout: 20_000 });
  });

  test('两种传输都拨不通 → 工具不出现,而且不是静默的', async ({ adminPage, browser }) => {
    // 一个根本不是 MCP 的地址。降级会让我们试两次,两次都失败 —— 结果必须是
    // "这台 server 的工具不存在",不是崩、也不是把半个握手的东西暴露出去。
    await addServer(adminPage, 'deadtools', 'http://mcp-server-mock:9100/healthz');
    await attachToCode(adminPage, 'deadtools', 'DEAD-ONE', 'deadrole');

    const answer = await askVisitorToCallExtTool(browser, 'DEAD-ONE', 'deadtools');
    await expect(answer).not.toBeEmpty({ timeout: 20_000 });
    await expect(answer, '拨不通就是没有这个工具,不该把 marker 变出来').not.toContainText(EXT_MARKER);
  });
});

// addServer —— 在 /admin/api·mcp 面板上注册一台外部 MCP server。
// **没有"传输类型"这个字段** —— 那正是这条 spec 要守住的:owner 只给地址。
async function addServer(
  page: Page, name: string, url: string, auth?: { name: string; value: string },
): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  await expect(page.getByTestId('mcp-servers-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('mcp-server-name').fill(name);
  await page.getByTestId('mcp-server-url').fill(url);
  if (auth) {
    await page.getByTestId('mcp-server-auth-name').fill(auth.name);
    await page.getByTestId('mcp-server-auth-value').fill(auth.value);
  }
  await page.getByTestId('mcp-server-add').click();
  await expect(
    page.getByTestId('mcp-servers-list').getByText(name, { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
}

async function attachToCode(
  page: Page, serverName: string, code: string, roleName: string,
): Promise<void> {
  const request = page.context().request;
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const serverID = await findServerID(request, csrf, serverName);
  const role = await createRole(request, csrf, {
    name: roleName,
    description: 'attaches an sse-transport MCP server',
    corpus_uris: ['wiki://**'],
    mcp_server_ids: [serverID],
  });
  await createCode(request, csrf, {
    code, label: `code for ${roleName}`, assumed_role_id: role.id,
  });
}

interface ServerRow { id: string; name: string }

async function findServerID(
  request: APIRequestContext, csrf: string, name: string,
): Promise<string> {
  const res = await request.get('http://localhost:8000/api/admin/mcp-servers', {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status(), 'list mcp servers').toBe(200);
  const rows = await res.json() as ServerRow[];
  const row = rows.find((r) => r.name === name);
  expect(row, `面板上加的 ${name} 必须在列表里`).toBeTruthy();
  return row?.id ?? '';
}

// askVisitorToCallExtTool —— 访客进来,让 AI 调那台 server 的工具,返回答案区 locator。
async function askVisitorToCallExtTool(
  browser: Browser, code: string, serverName: string,
) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, code);
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 15_000 });
  const skip = page.getByTestId('visitor-name-skip');
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skip.click();
  }
  const tag = await scriptMockToolCall(page.request, {
    name: `ext_${serverName}_ping_external`, args: {},
  });
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(`call the external tool${tag}`);
  await input.press('Enter');
  return page.locator('[data-testid="answer-body"]');
}
