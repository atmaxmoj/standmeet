// tool-page-update-handle.spec.ts —— Phase E-14b MCP parity:
// owner 在 Claude Code 调 page.set_handle("new-handle") 改 public URL
// prefix；老 handle 留为 alias (handle_aliases 表) 让现有 AccessCode QR
// 仍能解析。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'page-handle@example.com', password: 'correct-horse-battery-staple',
  handle: 'old-handle', fullName: 'Page Handle Owner',
};

interface UpdateHandleResp { owner_id: string; handle: string }

test.describe('MCP page.set_handle', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('page.set_handle changes the owner handle; admin /me reflects',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'page-handle-token');
      const sid = await initMCP(request, apiToken);

      const resp = await callTool<UpdateHandleResp>(
        request, apiToken, sid, 'page.set_handle',
        { handle: 'new-handle' },
      );
      expect(resp.handle).toBe('new-handle');

      // me 回 {owner, settings}(admin 的 GET /me 一直是这个信封)。
      interface MeResp { owner: { handle: string } }
      const me = await callTool<MeResp>(request, apiToken, sid, 'me', {});
      expect(me.owner.handle).toBe('new-handle');
      await request.dispose();
    });

  test('page.set_handle with invalid handle returns isError',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'page-handle-token-2');
      const sid = await initMCP(request, apiToken);

      await expect(
        callTool(request, apiToken, sid, 'page.set_handle',
          { handle: 'A!' }),
      ).rejects.toThrow(/handle must be 2-64 chars/);
      await request.dispose();
    });
});
