// external-mcp-tools.spec.ts —— an owner-registered external MCP server
// wired into visitor chat.
//
// Business story:
//   alice registers 'host-tool' in Claude Desktop via mcp_server_create,
//   pointing at the mcp-server-mock started by docker-compose (exposes a
//   ping_external tool that returns `[EXT-MCP-MARKER]`). She creates INVITE
//   EXT-001 attaching this server. A visitor chats with EXT-001 → backend
//   dials mcp-server-mock → ListTools → exposes ext_host-tool_ping_external
//   to the AI → the mock path's ExecuteTool is called once → the external
//   server returns the marker → backend wraps it as a tool_result → the mock
//   provider echoes [skill_result:...] (reusing the skill-result echo) into
//   the reply.
//
// UI-driven (G-1): visitor opens a real browser → the throbber
// tool-throbber-ext_host-tool_ping_external appears + answer-body contains EXT_MARKER.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

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
  id: string;
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
      // Mock is pure registration — register the ext tool the AI should dispatch
      // (backend really calls mcp-server-mock; its EXT_MARKER result echoes back).
      const tag = await scriptMockToolCall(page.request, {
        name: 'ext_host-tool_ping_external', args: {},
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`call the external tool${tag}`);
      await input.press('Enter');

      // Evidence goes through a persistent signal: answer-body contains the ext
      // server's reply marker — proof the MCP client really dialed
      // mcp-server-mock and the tool result round-tripped back. The throbber is
      // a single-value transient state (the local mock round-trips too fast,
      // React batches it away, the DOM never gets a chance to paint it), so
      // this test doesn't gamble on it; the throbber's lifecycle is verified
      // separately by visitor-chat-throbber-*.
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
  await createCodeAttachingServer(request, csrf, server.id);
}

async function createCodeAttachingServer(
  request: APIRequestContext, csrf: string, serverID: string,
): Promise<void> {
  // A.3-IAM-5: create a role with the mcp server attached, then issue a code with that role id.
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
