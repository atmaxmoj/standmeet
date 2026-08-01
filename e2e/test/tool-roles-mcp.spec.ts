// tool-roles-mcp.spec.ts —— Phase E-6 MCP parity: owner CRUDs Roles
// via MCP (Claude Code conversation), not just admin REST。
//
// Tools: role_create / role_list / role_delete。publicRow builtin
// 不可删 (usecase 拦截，MCP 返 isError)。

import type { APIRequestContext, Playwright } from '@playwright/test';

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

// 一个 role 在每个面上是同一份形状(id / skill_ids / mcp_server_ids)——
// 归一化前 MCP 那份是另一套字段名(role_id / skill_count / mcp_server_count)。
interface RoleCreateResp { id: string; name: string }
interface RoleRow {
  id: string;
  name: string;
  description?: string;
  corpus_uris: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  is_builtin?: boolean;
}
interface OK { ok: boolean }

// expectDeleteRemovesIt —— 建一个再删掉,列表里就没了。
async function expectDeleteRemovesIt(
  request: APIRequestContext, apiToken: string, sid: string,
): Promise<void> {
  const created = await callTool<RoleCreateResp>(
    request, apiToken, sid, 'role_create',
    { name: 'role-to-delete', corpus_uris: [] },
  );
  const del = await callTool<OK>(
    request, apiToken, sid, 'role_delete', { role_id: created.id },
  );
  expect(del.ok).toBe(true);
  const list = await callTool<RoleRow[]>(request, apiToken, sid, 'role_list', {});
  expect(list.find((r) => r.id === created.id)).toBeUndefined();
}

// expectUnknownSkillRejected —— 挂一个不存在的 skill:role 写入要说清是"这个 id 找不到",
// 而不是一句 internal error。存在性校验由组装根的适配器做(它认识 marketplace),错误经
// access 自己的端口哨兵回来 —— 接错了这句话就会退化成兜底文案。
async function expectUnknownSkillRejected(
  request: APIRequestContext, apiToken: string, sid: string,
): Promise<void> {
  await expect(
    callTool(request, apiToken, sid, 'role_create', {
      name: 'role-with-bogus-skill',
      corpus_uris: [],
      skill_ids: ['00000000-0000-0000-0000-000000000000'],
    }),
  ).rejects.toThrow(/skill ids not found/);
}

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
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

      const list = await callTool<RoleRow[]>(
        request, apiToken, sid, 'role_list', {},
      );
      const found = list.find((r) => r.id === created.id);
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
      await expectDeleteRemovesIt(request, apiToken, sid);
      await request.dispose();
    });

  test('role_create with an unknown skill id says which reference is missing',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await expectUnknownSkillRejected(request, apiToken, sid);
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
          { role_id: publicRow.id }),
      ).rejects.toThrow(/builtin role cannot be deleted/);
      await request.dispose();
    });
});
