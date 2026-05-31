// tool-endpoint-ext-mcp.spec.ts —— visitor 通过 per-tool HTTP 端点直调
// owner-registered 外部 MCP server 暴露的 tool。命名 ext_<server>_<tool>
// 跟 chat path 一字不差；executor 走 backend MCP client 拨号 → 调
// upstream → 返 tool_result。
//
// 业务故事：owner 注册 host-tool 指 mcp-server-mock；recruiter 持
// EXT-001 code 入 session；前端 (pi-agent-core) 调 POST /tools/
// ext_host-tool_ping_external → 200 + result 含外部 server 返的
// EXT-MCP-MARKER。换持没挂这个 server 的 code → 404。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool as callMCPTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'ext-mcp-tool@example.com', password: 'correct-horse-battery-staple',
  handle: 'ext-mcp-tool', fullName: 'Ext MCP Tool Owner',
};

const SERVER_NAME = 'host-tool';
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';
const UNREACHABLE_SERVER_NAME = 'dead-server';
const UNREACHABLE_MCP_URL = 'http://nonexistent-host-99999:9999/mcp';
const TOOL_NAME = `ext_${SERVER_NAME}_ping_external`;
const EXT_MARKER = '[EXT-MCP-MARKER]';

const CODE_WITH_SERVER = 'EXT-GRANT';
const CODE_NO_SERVER = 'EXT-NONE';
const CODE_UNREACHABLE = 'EXT-DEAD';

interface CreateServerResp { server_id: string; name: string; url: string }

interface ExtToolResult { content?: { text?: string }[] }

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: ExtToolResult | string;
  capability_state?: SessionCapability[];
}

async function callExtTool(
  request: APIRequestContext, sess: VisitorSession,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${TOOL_NAME}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: {},
    },
  );
  const status = res.status();
  const body = await res.json() as ToolResp;
  return { status, body };
}

async function registerExtServer(request: APIRequestContext): Promise<string> {
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'ext-mcp-tool-token');
  const sid = await initMCP(request, apiToken);
  const server = await callMCPTool<CreateServerResp>(
    request, apiToken, sid, 'mcp_server_create',
    { name: SERVER_NAME, url: MOCK_MCP_URL },
  );
  return server.server_id;
}

async function createRoleAndCode(
  request: APIRequestContext, csrf: string,
  serverID: string | null, code: string,
): Promise<void> {
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: `role-${code}`, description: 'role for ext-mcp-tool spec',
      prompt_id: null, corpus_uris: ['wiki://**', 'output://**'],
      skill_ids: [],
      mcp_server_ids: serverID ? [serverID] : [],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code, label: code, suggested_questions: [],
      assumed_role_id: role.id,
    },
  });
  if (codeRes.status() !== 201) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
}

test.describe('tool endpoint · external MCP server tool', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    const serverID = await registerExtServer(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createRoleAndCode(request, csrf, serverID, CODE_WITH_SERVER);
    await createRoleAndCode(request, csrf, null, CODE_NO_SERVER);
    await request.dispose();
  });

  test('role attaches ext server → 200 + ok:true + result includes ext marker',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE_WITH_SERVER, visitor_name: 'V',
      });
      const { status, body } = await callExtTool(request, sess);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      // Result shape varies (raw mcp envelope or stringified) — just assert
      // the marker shows up somewhere in the serialized result.
      const resultStr = JSON.stringify(body.result ?? '');
      expect(resultStr, 'ext marker in result').toContain(EXT_MARKER);
      await request.dispose();
    });

  test('role attaches ext server → capability_state lists ext.mcp enabled',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE_WITH_SERVER, visitor_name: 'V',
      });
      const { body } = await callExtTool(request, sess);
      const extCap = body.capability_state?.find(c => c.id === 'ext.mcp');
      expect(extCap, 'ext.mcp cap visible').toBeDefined();
      expect(extCap?.enabled).toBe(true);
      await request.dispose();
    });

  test('role without ext server → 404 + capability_not_enabled',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE_NO_SERVER, visitor_name: 'V',
      });
      const { status, body } = await callExtTool(request, sess);
      expect(status).toBe(404);
      expect(body.reason).toBe('capability_not_enabled');
      await request.dispose();
    });

  test('role attaches only an UNREACHABLE server → 404 + capability_not_enabled (silent dial fail)',
    async ({ playwright }) => {
      // 实现选择 (agentskills_ext_mcp.go): dial 失败 silently skip server，
      // 全失败 → bundle.tools 空 → ErrHidden → cap absent → 404。这里
      // 验证这一兜底，而不是 plan 原文的 "tool envelope external_mcp_unreachable"
      // (plan 跟实现不一致，按实现写真行为)。
      const request = await playwright.request.newContext();
      await assertUnreachableServerReturns404(request);
      await request.dispose();
    });
});

async function setupUnreachableCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'ext-mcp-dead-token');
  const sid = await initMCP(request, apiToken);
  const dead = await callMCPTool<CreateServerResp>(
    request, apiToken, sid, 'mcp_server_create',
    { name: UNREACHABLE_SERVER_NAME, url: UNREACHABLE_MCP_URL },
  );
  await createRoleAndCode(request, csrf, dead.server_id, CODE_UNREACHABLE);
}

async function assertUnreachableServerReturns404(
  request: APIRequestContext,
): Promise<void> {
  const setupReq = await request.storageState();
  void setupReq;
  // setup via the same request context (handler chain is auth-free for /admin/login)
  await setupUnreachableCode(request);
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE_UNREACHABLE, visitor_name: 'V',
  });
  const deadToolName = `ext_${UNREACHABLE_SERVER_NAME}_ping_external`;
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${deadToolName}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: {},
    },
  );
  expect(res.status()).toBe(404);
  const body = await res.json() as ToolResp;
  expect(body.reason).toBe('capability_not_enabled');
  // ext.mcp cap 也不应在 fresh state (因为 dial fail → ErrHidden)
  const extCap = body.capability_state?.find(c => c.id === 'ext.mcp');
  expect(extCap, 'ext.mcp cap absent when all servers unreachable').toBeUndefined();
}
