// external-mcp-auth-header.spec.ts —— owner 在面板上填的那对认证头,**真的发到对面了**。
//
// 这条 spec 存在,是因为这条路以前一行覆盖都没有。owner 注册一台外部 MCP server 时可以填
// 一对认证头(几乎所有真实的 server 都要),它加密进库、拨号时解开、随 HTTP 请求发出去。
// 中间任何一环断掉 —— 忘了带头、解错了、连解封那一步都没做 —— **没有任何测试会变红**:
// 既有的 ext-mcp 用例连的都是不要认证的 mock 入口。
// (docs/real-env-verification/items/ext-mcp.md 的 check 1 / check 4 早就写着这个缺口。)
//
// 对面用的是 mcp-server-mock 的 /mcp-auth:头不对就 401,连 MCP 握手都不给。于是"头有没有
// 发出去"变成访客那边看得见的事:头对 → 调得动那台 server 的工具,回包 marker 落进答案;
// 头错 → 拨不通 → 工具压根不存在,marker 永远不会出现。
//
// **两条一起才成立**:只有"对"那条会在断言根本不咬人的时候照样绿(比如 marker 恰好来自
// 别处);只有"错"那条则证明不了头发出去过。
//
// 两个 owner 面里走**面板**这一条 —— MCP 那条已有覆盖(external-mcp-tools),缺的是面板。
// 密钥框是 type=password,填完看不见,所以这条 spec 不断言"页面上显示了什么",只断言
// **对面收到了什么**:那才是这个字段唯一有意义的回执。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { enterCodeSession, gotoAdminSection } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'mcpauth@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mcpauth',
  fullName: 'MCP Auth Owner',
};

// /mcp-auth —— mock 上那个**要认证**的入口。头不对直接 401。
const AUTHED_MCP_URL = 'http://mcp-server-mock:9100/mcp-auth';
const AUTH_HEADER_NAME = 'X-Mock-Auth';
const AUTH_HEADER_VALUE = 'mock-secret-token';

const GOOD_SERVER = 'authedtools';
const BAD_SERVER = 'wrongkeytools';
const GOOD_CODE = 'MCPAUTH-OK';
const BAD_CODE = 'MCPAUTH-BAD';
const EXT_MARKER = '[EXT-MCP-MARKER]';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('owner 填的 MCP 认证头真的发到对面', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('头填对 → 调得动那台 server 的工具,回包落进答案', async ({ adminPage, browser }) => {
    await addServerOnPanel(adminPage, GOOD_SERVER, AUTH_HEADER_VALUE);
    await attachToCode(adminPage, GOOD_SERVER, GOOD_CODE, 'authedrole');

    const answer = await askVisitorToCallExtTool(browser, GOOD_CODE, GOOD_SERVER);
    await expect(
      answer,
      `owner 填的 ${AUTH_HEADER_NAME} 必须随拨号发出去,否则对面 401`,
    ).toContainText(EXT_MARKER, { timeout: 20_000 });
  });

  test('头填错 → 对面 401,那台 server 的回包永远不出现', async ({ adminPage, browser }) => {
    await addServerOnPanel(adminPage, BAD_SERVER, 'not-the-secret');
    await attachToCode(adminPage, BAD_SERVER, BAD_CODE, 'wrongkeyrole');

    // 先等界面真的答完了再断言"没有 marker" —— 不等的话这条断言在页面还空着时就过了,
    // 那是一条永远不会红的断言。
    const answer = await askVisitorToCallExtTool(browser, BAD_CODE, BAD_SERVER);
    await expect(answer).not.toBeEmpty({ timeout: 20_000 });
    await expect(
      answer,
      '认证头不对时不该有回包漏出来 —— 拨不通就是拨不通,不能退化成"不带头再试一次"',
    ).not.toContainText(EXT_MARKER);
  });
});

// addServerOnPanel —— 在 /admin/api 的面板上填一台外部 MCP server(含认证头)。
// 走界面,不走接口:这条 spec 验的就是 owner 手填的那对头。
async function addServerOnPanel(
  page: Page, name: string, authValue: string,
): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  await expect(page.getByTestId('mcp-servers-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('mcp-server-name').fill(name);
  await page.getByTestId('mcp-server-url').fill(AUTHED_MCP_URL);
  await page.getByTestId('mcp-server-auth-name').fill(AUTH_HEADER_NAME);
  await page.getByTestId('mcp-server-auth-value').fill(authValue);
  await page.getByTestId('mcp-server-add').click();
  // 列表里出现这一行 = 真落库了(不是表单自己清空的假象)。
  await expect(
    page.getByTestId('mcp-servers-list').getByText(name, { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
}

// attachToCode —— 把这台 server 挂进一个 role,再发一个 code。访客拿这个 code 进来。
async function attachToCode(
  page: Page, serverName: string, code: string, roleName: string,
): Promise<void> {
  const request = page.context().request;
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const serverID = await findServerID(request, csrf, serverName);
  const role = await createRole(request, csrf, {
    name: roleName,
    description: 'attaches an auth-header MCP server',
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

// askVisitorToCallExtTool —— 访客用这个 code 进来,让 AI 去调那台 server 的工具,
// 返回答案区的 locator。mock provider 是纯注册式的:这里注册"下一轮调这个工具"。
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
