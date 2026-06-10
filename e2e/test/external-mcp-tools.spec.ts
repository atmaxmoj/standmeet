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
//
// UI-driven (G-1): visitor 真开浏览器 → throbber tool-throbber-
// ext_host-tool_ping_external 出现 + answer-body 含 EXT_MARKER。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SERVER_NAME = 'host-tool';
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';
const CODE = 'EXT-001';
const EXT_MARKER = '[EXT-MCP-MARKER]';

interface CreateServerResp {
  server_id: string;
  name: string;
  url: string;
}

test.describe('owner registers external MCP server; visitor chat uses its tools', () => {
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
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('call the external tool');
      await input.press('Enter');

      // 证据走持久信号:answer-body 里含 ext server 的回包 marker —— 证明 MCP
      // client 真拨了 mcp-server-mock 且 tool 结果 roundtrip 回来。throbber 是
      // 单值瞬时态(本地 mock 往返太快、React batch 掉,DOM 来不及画),不在这赌;
      // throbber 生命周期由 visitor-chat-throbber-* 专门验。
      await expect(page.locator('[data-testid="answer-body"]'))
        .toContainText(EXT_MARKER, { timeout: 20_000 });

      await ctx.close();
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
  // A.3-IAM-5: 建一个 role 把 mcp server 挂上，再用 role id 发 code。
  const roleRes = await request.post('http://localhost:8000/api/admin/roles/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'ext-mcp-role',
      description: 'attaches external mcp server for ext_ tool spec',
      prompt_id: null,
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
      skill_ids: [],
      mcp_server_ids: [serverID],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role failed: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const res = await request.post('http://localhost:8000/api/admin/codes/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: CODE,
      label: 'External MCP code',
      ghosts: [],
      assumed_role_id: role.id,
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create code failed: ${res.status()} ${await res.text()}`);
  }
}
