// b5-owner-only-isolation.spec.ts —— Phase B-5: 验所有 owner-only
// capability (owner.me / seo.bundle / 后续迁入的 jobs / resume / applications
// / custom_page) 都不在 visitor session 的 capability map 或 tool_specs。
//
// 现有 registry-invariants spec 已覆盖 visitor_only ↔ no owner MCP 一侧；
// 本 spec 加强反向：枚举所有 owner-only ID + 其 OwnerMCPBinding 暴露的
// tool name，确保都没漏到 visitor 那边。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, listTools } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'b5@example.com', password: 'correct-horse-battery-staple',
  handle: 'b5', fullName: 'B-Five Owner',
};

const CODE = 'B5-001';

type PW = Parameters<Parameters<typeof test>[1]>[0]['playwright'];

interface RegCap { id: string; shape: string }
interface RegistryListResp { capabilities: RegCap[] }
interface VisitorCap { id: string }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
}

test.describe('Phase B-5 owner-only capability isolation', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'b5-role', description: 'b5 spec role',
      corpus_uris: ['wiki://**', 'output://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'b5', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  // 原来这条点名 owner.me + seo.bundle 当哨兵。它们搬进出站收口之后就不在 capreg 里了，
  // 于是这条会因为**搬家**而红 —— 它守的其实不是那两个名字，是「owner 能做的事一件都不
  // 漏给访客」。所以改成对着**整张 owner 工具面**比，谁搬家都不影响它守的东西。
  test('the whole owner tool surface is disjoint from the visitor tool surface',
    ownerSurfaceStaysOwnerSide);

  test('none of the owner-only capability IDs appear in a visitor session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const ownerOnlyIDs = await fetchOwnerOnlyIDs(request);
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const visitorCapIDs = new Set(body.capabilities.map((c) => c.id));
      for (const id of ownerOnlyIDs) {
        expect(visitorCapIDs.has(id),
          `owner-only ${id} must not appear in visitor capability map`).toBe(false);
      }
      await request.dispose();
    });

});

// ownerSurfaceStaysOwnerSide —— owner 用真 MCP 客户端能调到的每一个工具，都不该出现在
// 访客那份 tool_specs 里。比的是**整张面**，不是几个手抄的名字：手抄的那份只在有人想起
// 来扩它时才增长。
async function ownerSurfaceStaysOwnerSide(
  { playwright }: { playwright: PW },
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'b5-surface');
  const sid = await initMCP(request, token);
  const ownerTools = (await listTools(request, token, sid)).map((t) => t.name);
  expect(ownerTools.length, 'the owner surface must not be empty').toBeGreaterThan(0);

  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const body = await fetchVisitorCapabilities(request, sess.session_token);
  const visitorTools = new Set(body.tool_specs.map((t) => t.name));
  for (const name of ownerTools) {
    expect(visitorTools.has(name),
      `owner tool ${name} must not be exposed to a visitor`).toBe(false);
  }
  await request.dispose();
}

async function fetchOwnerOnlyIDs(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BACKEND}/internal/diag/registry`);
  if (res.status() !== 200) throw new Error(`registry-list: ${res.status()}`);
  const body = await res.json() as RegistryListResp;
  return body.capabilities.filter((c) => c.shape === 'owner_only').map((c) => c.id);
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/diag/session`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}
