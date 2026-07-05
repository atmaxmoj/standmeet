// tool-roles-mcp.spec.ts —— Phase E-6 MCP parity: owner CRUDs Roles
// via MCP (Claude Code conversation), not just admin REST。
//
// Tools: role_create / role_list / role_delete。publicRow builtin
// 不可删 (usecase 拦截，MCP 返 isError)。

import type { Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'roles-mcp@example.com', password: 'correct-horse-battery-staple',
  handle: 'roles-mcp', fullName: 'Roles MCP Owner',
};

// seedRolesMCP —— claim + login + API token + MCP session。抽出 beforeAll
// 让 describe 回调 < 70 行 (max-lines-per-function)。
async function seedRolesMCP(
  playwright: Playwright,
): Promise<{ sid: string; apiToken: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'roles-mcp-token');
  const sid = await initMCP(request, apiToken);
  await request.dispose();
  return { sid, apiToken };
}

interface RoleCreateResp { role_id: string; name: string }
interface RoleRow {
  role_id: string;
  name: string;
  description?: string;
  corpus_uris: string[];
  skill_count: number;
  mcp_server_count: number;
  is_builtin?: boolean;
}
interface OK { ok: boolean }

test.describe('Phase E-6 roles CRUD via MCP', () => {
  let sid: string;
  let apiToken: string;

  test.beforeAll(async ({ playwright }) => {
    ({ sid, apiToken } = await seedRolesMCP(playwright));
  });

  test('role_create + role_list returns the new role with corpus_uris',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const created = await callTool<RoleCreateResp>(
        request, apiToken, sid, 'role_create',
        {
          name: 'recruiter-default',
          description: 'role for recruiters from job applications',
          corpus_uris: ['wiki://**', 'output://**'],
        },
      );
      expect(created.name).toBe('recruiter-default');
      expect(created.role_id).toMatch(/^[0-9a-f-]{36}$/);

      const list = await callTool<RoleRow[]>(
        request, apiToken, sid, 'role_list', {},
      );
      const found = list.find((r) => r.role_id === created.role_id);
      expect(found?.name).toBe('recruiter-default');
      expect([...(found?.corpus_uris ?? [])].sort()).toEqual(
        ['output://**', 'wiki://**'],
      );
      expect(found?.is_builtin).not.toBe(true);

      const publicRow = list.find((r) => r.is_builtin === true);
      expect(publicRow, 'public role should be seeded').toBeDefined();
      await request.dispose();
    });

  test('role_delete on non-builtin removes it from role_list',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const created = await callTool<RoleCreateResp>(
        request, apiToken, sid, 'role_create',
        { name: 'role-to-delete', corpus_uris: [] },
      );
      const del = await callTool<OK>(
        request, apiToken, sid, 'role_delete',
        { role_id: created.role_id },
      );
      expect(del.ok).toBe(true);
      const list = await callTool<RoleRow[]>(
        request, apiToken, sid, 'role_list', {},
      );
      expect(list.find((r) => r.role_id === created.role_id)).toBeUndefined();
      await request.dispose();
    });

  test('role_delete on builtin publicRow returns isError',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const list = await callTool<RoleRow[]>(
        request, apiToken, sid, 'role_list', {},
      );
      const publicRow = list.find((r) => r.is_builtin === true);
      if (!publicRow) throw new Error('public missing');
      await expect(
        callTool(request, apiToken, sid, 'role_delete',
          { role_id: publicRow.role_id }),
      ).rejects.toThrow(/builtin role cannot be deleted/);
      await request.dispose();
    });
});
