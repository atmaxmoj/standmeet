// b4-owner-cap-me.spec.ts —— `me` 这个 owner 工具的契约。
//
// 它换过两次家：先从 server.go 的 AddTool 迁成 capreg capability（那时这条 spec 断言
// registry 里有 owner.me），再从 capreg 迁进出站收口（现在 owner 域自己声明它）。
// 断言那个**中间形态**的两条已经删掉——它们守的是搬家的痕迹，不是契约。
//
// 留下的是一直成立的那件事：
//   1. owner 用真 MCP 客户端调 `me`，拿到自己的 profile
//   2. `me` 不出现在访客那一侧（owner 的东西不漏给访客）

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
// me 回 {owner, settings}（面板的 GET /me 一直是这个信封；MCP 那份以前是手拼字符串
// 出来的四个字段，连转义都没有）。
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
