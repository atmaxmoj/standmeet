// tool-codes-create-update.spec.ts —— Phase E-13 MCP parity: owner issues access
// codes + updates quotas via MCP (Claude Code conversation), not just admin REST.
//
// E-13 also fixed CodeRepo.Revoke's 0-row bug — beyond b6-codes-revoke-mcp, this spec also
// indirectly covers the same kind of not-found path for update_quotas.

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

// seedCodesMCP — claim + login + role + API token + MCP session. Extracted out of beforeAll
// to keep the describe callback under 70 lines (max-lines-per-function).
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

// Once both faces share one payload, what MCP gets back is **the whole code row** (the same
// shape as the /codes/ panel): the row's primary key is called `id`, not the old
// MCP-private `code_id`. The input parameter is still named code_id — that names "which
// code", not a field on the row.
interface CreateResp { id: string; code: string; label: string }
interface UpdateQuotasResp {
  id: string;
  max_members: number | null;
  max_turns_per_session: number | null;
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// expectQuotaUpdate — changing one of the kernel's own quotas (member count / turns per
// session) leaves the other one unaffected.
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

// expectCodeFieldRoundTrip — a field a capability owns on a code (booker's max_bookings is
// the first one) is declared through CodeConfig: whatever gets written must read back
// unchanged.
//
// **Neither direction of this was covered before** — the only prior test was "quota hits
// zero → tool disappears"; nobody asked whether the written value actually made it back onto
// the code, or whether the field still shows up in the input schema. And since the schema is
// now computed from the declaration, the one symptom of getting that computation wrong is
// this field quietly vanishing.
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
