// dock-buttons-mcp.spec.ts —— #109/#110 B：owner 侧本地 MCP 工具 `roles.set_dock_buttons`
// 跟 admin UI 走同一份服务端状态 + 同一套校验（#118 能力 parity：owner 的 Claude 也能配 dock 按钮）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole, getRoleByName } from '@/fixtures/roles';

const OWNER = {
  email: 'dock-mcp@example.com', password: 'correct-horse-battery-staple',
  handle: 'dockmcp', fullName: 'Dock MCP Owner',
};
const CAP_SUMMARIZE = 'summarize_conversation';
const CAP_RETRIEVAL = 'corpus.retrieval';
const TOOL = 'roles.set_dock_buttons';

let request: APIRequestContext;
let token = '';
let sid = '';
let roleID = '';

test.describe('dock buttons · B — owner MCP tool ↔ admin parity', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'mcp-role', description: 'm', corpus_uris: ['wiki://**'],
    });
    roleID = role.id;
    token = await createAPIToken(request, csrf, 'dock-mcp-seed');
    sid = await initMCP(request, token);
  });

  test.afterAll(async () => { await request.dispose(); });

  test('B1 set_dock_buttons via MCP → same server state as the UI would produce',
    async () => {
      await callTool(request, token, sid, TOOL, {
        role_id: roleID,
        buttons: [
          { capability_id: CAP_SUMMARIZE, trigger: 'Summarize please' },
          { capability_id: CAP_RETRIEVAL, trigger: 'What have we covered?' },
        ],
      });
      const role = await getRoleByName(request, 'mcp-role');
      expect(role.dock_buttons).toHaveLength(2);
      expect(role.dock_buttons?.[0]).toMatchObject(
        { capability_id: CAP_SUMMARIZE, trigger: 'Summarize please' });
    });

  test('B2 the same validation applies over MCP (>2 rejected — server state unchanged)',
    async () => {
      // first put a known-good single button
      await callTool(request, token, sid, TOOL, {
        role_id: roleID,
        buttons: [{ capability_id: CAP_SUMMARIZE, trigger: 'ok' }],
      });
      // then an invalid 3-button set — must be rejected, leaving the good state intact
      await callTool(request, token, sid, TOOL, {
        role_id: roleID,
        buttons: [
          { capability_id: CAP_SUMMARIZE, trigger: 'a' },
          { capability_id: CAP_RETRIEVAL, trigger: 'b' },
          { capability_id: CAP_SUMMARIZE, trigger: 'c' },
        ],
      }).catch(() => undefined); // tool error may surface as a throw; either way state must not change
      const role = await getRoleByName(request, 'mcp-role');
      expect(role.dock_buttons, 'invalid MCP set did not overwrite').toHaveLength(1);
      expect(role.dock_buttons?.[0]?.trigger).toBe('ok');
    });
});
