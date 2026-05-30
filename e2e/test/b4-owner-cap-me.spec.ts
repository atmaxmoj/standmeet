// b4-owner-cap-me.spec.ts —— Phase B-4 契约：`me` 这个 owner MCP tool 从
// 老 server.go AddTool 调用迁成 agentskills Capability + OwnerMCPBinding；
// adapter (mcp/adapter.go) 把 binding 桥接到 mcp-go server。
//
// 验：
//   1. /internal/test/registry-list 含 owner.me，shape=owner_only
//   2. owner via MCP 调 'me' 仍然返 owner profile (regression — api-tokens
//      spec 已覆盖，这里加单测让 B-4 改动失败时立即 surface)
//   3. owner.me 不出现在 visitor session 的 capability map (Shape 自洽)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'b4@example.com', password: 'correct-horse-battery-staple',
  handle: 'b4', fullName: 'B-Four Owner',
};

const CODE = 'B4-001';

interface RegCap { id: string; shape: string }
interface RegistryListResp { capabilities: RegCap[] }
interface VisitorCap { id: string }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
}
interface MeResp { owner_id: string; email: string; handle: string; full_name: string }

test.describe('Phase B-4 owner.me Capability via registry adapter', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'b4-role', description: 'b4',
      corpus_uris: ['wiki://**', 'output://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'b4 spec', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('registry-list contains owner.me with shape=owner_only',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const res = await request.get(`${BACKEND}/internal/test/registry-list`);
      if (res.status() !== 200) throw new Error(`registry-list: ${res.status()}`);
      const body = await res.json() as RegistryListResp;
      const me = body.capabilities.find((c) => c.id === 'owner.me');
      expect(me, 'owner.me must appear').toBeDefined();
      expect(me?.shape).toBe('owner_only');
      await request.dispose();
    });

  test('owner.me does NOT appear in visitor session capability map',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const res = await request.get(
        `${BACKEND}/internal/test/visitor-capabilities`,
        { headers: { 'X-Session-Token': sess.session_token } },
      );
      if (res.status() !== 200) throw new Error(`visitor-caps: ${res.status()}`);
      const body = await res.json() as VisitorCapabilitiesResp;
      expect(body.capabilities.find((c) => c.id === 'owner.me')).toBeUndefined();
      expect(body.tool_specs.find((t) => t.name === 'me')).toBeUndefined();
      await request.dispose();
    });

  test('me callable via owner MCP returns owner profile',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'b4-me-token');
      const sid = await initMCP(request, apiToken);
      const me = await callTool<MeResp>(request, apiToken, sid, 'me', {});
      expect(me.email).toBe(OWNER.email);
      expect(me.handle).toBe(OWNER.handle);
      expect(me.full_name).toBe(OWNER.fullName);
      await request.dispose();
    });
});

// ─── shared role/code helpers (kept inline; B-4 spec scope is narrow) ──

async function bareLogin(request: APIRequestContext) {
  await loginAPI(request, OWNER.email, OWNER.password);
}
void bareLogin;
