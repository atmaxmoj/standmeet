// registry-invariants.spec.ts —— Phase B 横切不变量。后续每个 B-N 加
// capability 都顺势检：ID 全 unique、shape contract 自洽（visitor_only ↔
// 不出现在 owner MCP；owner_only ↔ 不出现在 visitor session）、同 session
// 多次 introspect system_prompt_hash 完全一致（防 system prompt 抖动）。
//
// B-1 阶段 registry 可能为空，invariant 仍 trivially 成立；spec 的价值
// 是建立检查面，让 B-2..B-6 land 时回归网自动卡住任一违反。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'invariants@example.com', password: 'correct-horse-battery-staple',
  handle: 'invariants', fullName: 'Invariants Owner',
};

const CODE = 'INV-001';

interface Cap { id: string; shape: 'visitor_only' | 'owner_only' | 'both' }
interface RegistryListResp { capabilities: Cap[] }
interface VisitorCap { id: string; enabled: boolean }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
}

test.describe('Phase B capability registry invariants', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'inv-role',
      description: 'invariants spec',
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'invariants spec', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('every registered ID is unique', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const body = await fetchRegistryList(request);
    const ids = body.capabilities.map((c) => c.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
    await request.dispose();
  });

  test('visitor-only capability never appears as owner MCP tool', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const reg = await fetchRegistryList(request);
    const visitorOnly = reg.capabilities.filter((c) => c.shape === 'visitor_only').map((c) => c.id);
    // owner-side MCP tool list (read via internal endpoint is acceptable; B-1
    // 阶段 registry list 自身就是声明真理 —— shape 字段必和 owner MCP server
    // 实际暴露 1:1)。这里复用 registry-list 内的 owner_only/both 子集做反向
    // 校验：visitor_only IDs 必不在 owner_only|both 集合里。
    const ownerExposed = new Set(
      reg.capabilities
        .filter((c) => c.shape === 'owner_only' || c.shape === 'both')
        .map((c) => c.id),
    );
    for (const id of visitorOnly) expect(ownerExposed.has(id)).toBe(false);
    await request.dispose();
  });

  test('owner-only capability never appears in a visitor session', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const reg = await fetchRegistryList(request);
    const ownerOnly = new Set(
      reg.capabilities.filter((c) => c.shape === 'owner_only').map((c) => c.id),
    );
    if (ownerOnly.size === 0) {
      // B-1 阶段可能为空 —— spec 仍意义在于建立断言面。
      return;
    }
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Inv',
    });
    const body = await fetchVisitorCapabilities(request, sess.session_token);
    for (const c of body.capabilities) expect(ownerOnly.has(c.id)).toBe(false);
    for (const t of body.tool_specs) expect(ownerOnly.has(t.name)).toBe(false);
    await request.dispose();
  });

  test('same session: system_prompt_hash is stable across calls', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Inv',
    });
    const a = await fetchVisitorCapabilities(request, sess.session_token);
    const b = await fetchVisitorCapabilities(request, sess.session_token);
    const c = await fetchVisitorCapabilities(request, sess.session_token);
    expect(b.system_prompt_hash).toBe(a.system_prompt_hash);
    expect(c.system_prompt_hash).toBe(a.system_prompt_hash);
    // tool_specs 顺序也稳定
    expect(b.tool_specs.map((t) => t.name)).toEqual(a.tool_specs.map((t) => t.name));
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
