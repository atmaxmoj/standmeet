// external-mcp-tools.spec.ts —— owner-registered 外部 MCP server 接进
// visitor chat。
//
// 业务故事：
//   alice 在 Claude Desktop 用 mcp_server_create 注册了 'host-tool' 指
//   docker-compose 起的 mcp-server-mock (暴露 ping_external tool 返
//   `[EXT-MCP-MARKER]`)。新建 INVITE EXT-001 attach 这个 server。访客用
//   EXT-001 聊 → backend 拨号 mcp-server-mock → ListTools → 给 AI 暴露
//   ext_host-tool_ping_external → mock 路径 ExecuteTool 调用一次 → 外部
//   server 返 marker → backend 包成 tool_result → mock provider echo
//   [skill_result:...] (复用 skill 结果 echo) 进 reply。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SERVER_NAME = 'host-tool';
// mcp-server-mock 暴露 9100；docker-compose 内部用 service 名。
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';
const CODE = 'EXT-001';
const EXT_MARKER = '[EXT-MCP-MARKER]';

interface CreateServerResp {
  server_id: string;
  name: string;
  url: string;
}

test.describe.serial('owner registers external MCP server; visitor chat uses its tools', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await registerServerAndCode(request);
    await request.dispose();
  });

  test('visitor chat dispatches ext_<server>_<tool> through MCP client',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
      });
      const res = await sendMessage(request, sess, 'call the external tool');
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body).toContain(EXT_MARKER);
    });
});

async function registerServerAndCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'b3-token');
  const sid = await initMCP(request, apiToken);
  const server = await callTool<CreateServerResp>(
    request, apiToken, sid, 'mcp_server_create', {
      name: SERVER_NAME,
      url: MOCK_MCP_URL,
    },
  );
  await createCodeAttachingServer(request, csrf, server.server_id);
}

async function createCodeAttachingServer(
  request: APIRequestContext, csrf: string, serverID: string,
): Promise<void> {
  const res = await request.post('http://localhost:8000/api/admin/codes/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: CODE,
      label: 'External MCP code',
      corpus_permissions: [],
      suggested_questions: [],
      mcp_server_ids: [serverID],
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create code failed: ${res.status()} ${await res.text()}`);
  }
}
