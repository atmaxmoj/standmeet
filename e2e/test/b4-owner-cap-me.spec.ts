// b4-owner-cap-me.spec.ts — the contract for the owner tool `me`.
//
// It has moved twice: first from `AddTool` in server.go into a capreg capability (at that point
// this spec asserted that `owner.me` existed in the registry), then from capreg into the outbound
// convergence point (now the owner domain declares it itself). The two assertions for that
// **intermediate shape** have since been deleted — they were guarding the traces of the move, not
// the contract.
//
// What remains is the thing that's always been true:
//   1. the owner calls `me` with a real MCP client and gets back their own profile
//   2. `me` does not appear on the visitor side (owner data doesn't leak to visitors)

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

interface VisitorCap { id: string }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
}
// me returns {owner, settings} (the panel's GET /me has always used this envelope; the MCP
// version used to be four fields hand-assembled into a string, without even escaping).
interface MeResp {
  owner: { owner_id: string; email: string; handle: string; full_name: string };
}

test.describe('owner `me` over MCP', () => {
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

  test('me does NOT appear in a visitor session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const res = await request.get(
        `${BACKEND}/internal/diag/session`,
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
      expect(me.owner.email).toBe(OWNER.email);
      expect(me.owner.handle).toBe(OWNER.handle);
      expect(me.owner.full_name).toBe(OWNER.fullName);
      await request.dispose();
    });
});

// ─── shared role/code helpers (kept inline; B-4 spec scope is narrow) ──

async function bareLogin(request: APIRequestContext) {
  await loginAPI(request, OWNER.email, OWNER.password);
}
void bareLogin;
