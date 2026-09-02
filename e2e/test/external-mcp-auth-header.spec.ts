// external-mcp-auth-header.spec.ts —— the auth header pair the owner fills into the panel
// **actually reaches the other side**.
//
// This spec exists because this path had zero coverage before. When an owner registers an
// external MCP server, they can fill in an auth header pair (almost every real server needs
// one); it gets encrypted into storage, decrypted when dialing out, and sent along with the
// HTTP request. If any link in that chain breaks — the header gets forgotten, decrypted
// wrong, or the unwrap step is never even implemented — **no test would go red**: the
// existing ext-mcp test cases only ever connect to a mock endpoint that requires no auth.
// (docs/real-env-verification/items/ext-mcp.md's check 1 / check 4 already flagged this gap.)
//
// The other side is mcp-server-mock's /mcp-auth: a wrong header gets a flat 401, not even
// the MCP handshake gets through. So "was the header actually sent" turns into something
// observable from the visitor side: header correct → the tool on that server can be called,
// its reply marker lands in the answer; header wrong → the dial fails → the tool simply
// doesn't exist, the marker never appears.
//
// **Both cases are needed together**: the "correct" case alone would stay green even when
// the assertion has no bite at all (e.g. the marker happens to come from somewhere else);
// the "wrong" case alone can't prove the header was ever sent.
//
// Of the two owner-facing surfaces, this test goes through the **panel** — the MCP surface
// already has coverage (external-mcp-tools), the panel was the gap. The secret field is
// type=password and unreadable once filled, so this spec doesn't assert "what the page
// shows" — it only asserts **what the other side received**: that's the only receipt this
// field can meaningfully give.

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

// /mcp-auth — the mock's endpoint that **requires auth**. A wrong header gets a flat 401.
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

    // Wait for the UI to actually finish answering before asserting "no marker" — without
    // waiting, this assertion would pass while the page is still empty, which makes it an
    // assertion that can never go red.
    const answer = await askVisitorToCallExtTool(browser, BAD_CODE, BAD_SERVER);
    await expect(answer).not.toBeEmpty({ timeout: 20_000 });
    await expect(
      answer,
      '认证头不对时不该有回包漏出来 —— 拨不通就是拨不通,不能退化成"不带头再试一次"',
    ).not.toContainText(EXT_MARKER);
  });
});

// addServerOnPanel — fills in an external MCP server (including the auth header) on the
// /admin/api panel. Goes through the UI, not the API: what this spec verifies is exactly
// the header pair the owner types by hand.
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
  // This row appearing in the list = it actually landed in storage (not just the form
  // clearing itself as an illusion of success).
  await expect(
    page.getByTestId('mcp-servers-list').getByText(name, { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
}

// attachToCode — attaches this server to a role, then issues a code. The visitor enters
// using this code.
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

// askVisitorToCallExtTool — a visitor enters using this code and has the AI call that
// server's tool; returns the locator for the answer area. The mock provider is purely
// registration-based: here it registers "call this tool on the next turn".
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
