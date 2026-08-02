// tool-codes-create-update.spec.ts —— Phase E-13 MCP parity: owner issues access
// codes + updates quotas via MCP (Claude Code conversation), not just admin REST.
//
// E-13 同时修了 CodeRepo.Revoke 的 0-row bug —— 已经在 b6-codes-revoke-mcp
// 之外用本 spec 也间接覆盖 update_quotas 的同类 not-found 路径。

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'codes-mcp@example.com', password: 'correct-horse-battery-staple',
  handle: 'codes-mcp', fullName: 'Codes MCP Owner',
};

// seedCodesMCP —— claim + login + role + API token + MCP session。抽出
// beforeAll 让 describe 回调 < 70 行 (max-lines-per-function)。
async function seedCodesMCP(
  playwright: Playwright,
): Promise<{ sid: string; apiToken: string; roleID: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'codes-mcp-role', description: 'role for codes mcp spec',
    corpus_uris: ['wiki://**'],
  });
  const apiToken = await createAPIToken(request, csrf, 'codes-mcp-token');
  const sid = await initMCP(request, apiToken);
  await request.dispose();
  return { sid, apiToken, roleID: role.id };
}

// 两个面同一份载荷之后，MCP 拿到的就是**整行码**（跟面板 /codes/ 一样的形状）：
// 行的主键叫 `id`，不是以前 MCP 私有那份的 `code_id`。入参仍叫 code_id —— 那是
// "对哪张码"，不是行里的字段。
interface CreateResp { id: string; code: string; label: string }
interface UpdateQuotasResp {
  id: string;
  max_members: number | null;
  max_turns_per_session: number | null;
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// expectQuotaUpdate —— 内核自己那几个配额（成员数 / 每会话轮次）改一个，另一个不受影响。
async function expectQuotaUpdate(
  request: APIRequestContext, apiToken: string, sid: string, roleID: string,
): Promise<void> {
  const created = await callTool<CreateResp>(
    request, apiToken, sid, 'codes.create',
    {
      code: 'MCP-QUOTAS-001', label: 'quotas spec',
      assumed_role_id: roleID, max_members: 3, max_turns_per_session: 10,
    },
  );
  const updated = await callTool<UpdateQuotasResp>(
    request, apiToken, sid, 'codes.update_quotas',
    { code_id: created.id, max_turns_per_session: 50 },
  );
  expect(updated.id).toBe(created.id);
  expect(updated.max_turns_per_session).toBe(50);
  expect(updated.max_members).toBe(3);
}

// expectCodeFieldRoundTrip —— 能力在码上占的字段（booker 的 max_bookings 是第一个）走
// CodeConfig 声明：写下去要能原样读回来。
//
// 这条**两个方向都没覆盖过** —— 从前只有"配额到了工具消失"那一条；写进去的值有没有回到码上、
// 入参 schema 里还有没有这个字段，都没人问。而 schema 现在是从声明算出来的，一旦算错，唯一的
// 症状就是这个字段安静地消失。
async function expectCodeFieldRoundTrip(
  request: APIRequestContext, apiToken: string, sid: string, roleID: string,
): Promise<void> {
  const created = await callTool<CreateResp>(
    request, apiToken, sid, 'codes.create',
    {
      code: 'MCP-CODEFIELD-001', label: 'code field spec',
      assumed_role_id: roleID, max_bookings: 7,
    },
  );
  const rows = await callTool<Array<{ id: string; max_bookings: number | null }>>(
    request, apiToken, sid, 'codes.list', {},
  );
  const mine = rows.find((r) => r.id === created.id);
  expect(mine, 'the created code is listed').toBeTruthy();
  expect(mine?.max_bookings, 'the capability field came back on the row').toBe(7);
}

test.describe('Phase E-13 codes create / update_quotas via MCP', () => {
  let sid: string;
  let apiToken: string;
  let roleID: string;

  test.beforeAll(async ({ playwright }) => {
    ({ sid, apiToken, roleID } = await seedCodesMCP(playwright));
  });

  test('codes.create issues an access code with quotas; visible in admin /codes/',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const created = await callTool<CreateResp>(
        request, apiToken, sid, 'codes.create',
        {
          code: 'MCP-CREATE-001', label: 'created via mcp',
          assumed_role_id: roleID,
          ghosts: ['why us?', 'why this role?'],
          max_members: 5,
          max_turns_per_session: 30,
        },
      );
      expect(created.code).toBe('MCP-CREATE-001');
      expect(created.label).toBe('created via mcp');

      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const list = await request.get(`${BACKEND}/api/admin/codes/`, {
        headers: { 'X-Csrftoken': csrf },
      });
      expect(list.status()).toBe(200);
      const rows = await list.json() as Array<{ id: string; code: string }>;
      expect(rows.find((c) => c.id === created.id)?.code)
        .toBe('MCP-CREATE-001');
      await request.dispose();
    });

  test('codes.update_quotas changes per-session turn cap; admin list reflects',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await expectQuotaUpdate(request, apiToken, sid, roleID);
      await request.dispose();
    });

  test('a capability field declared on the code round-trips: set → read back',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await expectCodeFieldRoundTrip(request, apiToken, sid, roleID);
      await request.dispose();
    });

  test('codes.update_quotas on unknown code_id returns isError (CodeRepo bug fix)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await expect(
        callTool(request, apiToken, sid, 'codes.update_quotas',
          { code_id: '00000000-0000-0000-0000-000000000000',
            max_turns_per_session: 99 }),
      ).rejects.toThrow(/code not found/);
      await request.dispose();
    });
});
