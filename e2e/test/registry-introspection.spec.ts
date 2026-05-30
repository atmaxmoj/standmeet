// registry-introspection.spec.ts —— Phase B-1 契约 spec：3 个 dev-only
// endpoint 的存在性 + 响应 shape。
//
// 这是整个 Capability Registry 改造的可观测出口；后续每个 B-N commit 都靠
// 同一组 endpoint 验装配结果。本 spec 只 assert 形状（200 + 字段齐），
// 不 assert 具体内容（哪些 capability 被注册）—— 那个由 invariants spec
// 跟具体 B-N spec 检。
//
// 三个 endpoint：
//   GET /internal/test/registry-list           —— 所有已注册 capability
//   GET /internal/test/visitor-capabilities    —— 给定 session 的装配结果
//   GET /internal/test/ext-mcp-conn-stats      —— 进程级 dial/close 计数

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'registry@example.com', password: 'correct-horse-battery-staple',
  handle: 'registry', fullName: 'Registry Owner',
};

const CODE = 'REG-001';

interface RegistryListResp {
  capabilities: Array<{
    id: string;
    shape: 'visitor_only' | 'owner_only' | 'both';
  }>;
}

interface VisitorCapabilitiesResp {
  capabilities: Array<{
    id: string;
    enabled: boolean;
    quota_remaining?: number;
    policy_summary?: string;
  }>;
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
}

interface ExtMCPStatsResp {
  dialed: number;
  closed: number;
}

test.describe('Phase B-1 capability registry dev endpoints', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'reg-role',
      description: 'registry spec role',
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'registry spec', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('registry-list returns deterministic shape', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const first = await fetchRegistryList(request);
    expect(Array.isArray(first.capabilities)).toBe(true);
    for (const c of first.capabilities) {
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
      expect(['visitor_only', 'owner_only', 'both']).toContain(c.shape);
    }
    // 顺序在多次调用之间稳定（cache key / system prompt hash 依赖确定性）。
    const second = await fetchRegistryList(request);
    expect(second.capabilities.map((c) => c.id))
      .toEqual(first.capabilities.map((c) => c.id));
    await request.dispose();
  });

  test('visitor-capabilities returns state + specs + hash', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Inspector',
    });
    const body = await fetchVisitorCapabilities(request, sess.session_token);
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(Array.isArray(body.tool_specs)).toBe(true);
    expect(typeof body.system_prompt_hash).toBe('string');
    expect(body.system_prompt_hash.length).toBeGreaterThan(0);
    for (const c of body.capabilities) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.enabled).toBe('boolean');
    }
    await request.dispose();
  });

  test('ext-mcp-conn-stats returns dial/close counters', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const stats = await fetchExtMCPStats(request);
    expect(typeof stats.dialed).toBe('number');
    expect(typeof stats.closed).toBe('number');
    expect(stats.dialed).toBeGreaterThanOrEqual(0);
    expect(stats.closed).toBeGreaterThanOrEqual(0);
    expect(stats.closed).toBeLessThanOrEqual(stats.dialed);
    await request.dispose();
  });
});

async function fetchRegistryList(request: APIRequestContext): Promise<RegistryListResp> {
  const res = await request.get(`${BACKEND}/internal/test/registry-list`);
  if (res.status() !== 200) {
    throw new Error(`registry-list: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as RegistryListResp;
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/test/visitor-capabilities`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}

async function fetchExtMCPStats(request: APIRequestContext): Promise<ExtMCPStatsResp> {
  const res = await request.get(`${BACKEND}/internal/test/ext-mcp-conn-stats`);
  if (res.status() !== 200) {
    throw new Error(`ext-mcp-conn-stats: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as ExtMCPStatsResp;
}
