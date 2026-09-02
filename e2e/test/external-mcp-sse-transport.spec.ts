// external-mcp-sse-transport.spec.ts —— an owner pastes in an MCP address using the
// **old HTTP+SSE** transport, and it still connects.
//
// In the MCP spec, HTTP+SSE is the older transport (2024-11-05); streamable HTTP
// replaced it on 2025-03-26. So most **new** remote servers are fine today — but plenty
// of services still expose the old `/sse` endpoint and never migrated, and an owner
// might have exactly that address in hand. Before this, `mcpclient.Dial` only ever
// called `NewStreamableHttpClient` — there wasn't a single line of SSE in the repo:
// paste an old address → dial fails → that server's tools **silently disappear**, with
// the UI never saying why.
//
// **The owner should never have to pick a transport by hand**: all they have is one
// address, and which transport it speaks is **a property of the other side** — it's our
// job to probe for it. So there is no "transport type" field here at all — the same
// registration form, the same URL field, and connecting just works.
//
// The other side is mcp-server-mock's `/sse` (a different face of the same server, an
// independent path that doesn't affect other specs).

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

// Three entry points, the same mock server:
//   /sse       the old-style HTTP+SSE (the star of this spec)
//   /mcp       streamable HTTP (regression control)
//   /mcp-auth  the one that requires auth (used by external-mcp-auth-header)
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
    // Send an auth header to the old endpoint: the mock's /sse doesn't validate the
    // header, so this asserts **it still connects even carrying the header** (if the
    // header got dropped as a streamable-only option, the SSE client would either
    // error out or connect bare).
    await addServer(adminPage, 'ssehdr', AUTHED_SSE_URL, {
      name: 'X-Mock-Auth', value: 'mock-secret-token',
    });
    await attachToCode(adminPage, 'ssehdr', 'SSE-HDR', 'ssehdrrole');

    const answer = await askVisitorToCallExtTool(browser, 'SSE-HDR', 'ssehdr');
    await expect(answer).toContainText(EXT_MARKER, { timeout: 20_000 });
  });

  test('两种传输都拨不通 → 工具不出现,而且不是静默的', async ({ adminPage, browser }) => {
    // An address that isn't an MCP server at all. The fallback logic makes us try
    // twice, and both fail — the result must be "this server's tools don't exist", not
    // a crash, and not exposing half of a broken handshake.
    await addServer(adminPage, 'deadtools', 'http://mcp-server-mock:9100/healthz');
    await attachToCode(adminPage, 'deadtools', 'DEAD-ONE', 'deadrole');

    const answer = await askVisitorToCallExtTool(browser, 'DEAD-ONE', 'deadtools');
    await expect(answer).not.toBeEmpty({ timeout: 20_000 });
    await expect(answer, '拨不通就是没有这个工具,不该把 marker 变出来').not.toContainText(EXT_MARKER);
  });
});

// addServer —— registers an external MCP server on the /admin/api·mcp panel.
// **There is no "transport type" field** — that's exactly what this spec is guarding:
// the owner only gives an address.
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

// askVisitorToCallExtTool —— a visitor enters, has the AI call that server's tool, and
// returns the answer-area locator.
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
