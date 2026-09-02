// registry-introspection.spec.ts -- Phase B-1 contract spec: existence + response shape of
// 3 dev-only endpoints.
//
// This is the observability exit for the whole Capability Registry rework; every following
// B-N commit relies on this same set of endpoints to verify assembly results. This spec
// only asserts shape (200 + fields present), not specific content (which capabilities got
// registered) -- that's checked by the invariants spec and the specific B-N specs.
//
// The three endpoints:
//   GET /internal/diag/registry       -- all registered capabilities
//   GET /internal/diag/session        -- assembly result for a given session
//   GET /internal/diag/ext-mcp-stats  -- process-level dial/close counts

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
    // Order is stable across repeated calls (cache key / system prompt hash rely on determinism).
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
  const res = await request.get(`${BACKEND}/internal/diag/registry`);
  if (res.status() !== 200) {
    throw new Error(`registry-list: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as RegistryListResp;
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

async function fetchExtMCPStats(request: APIRequestContext): Promise<ExtMCPStatsResp> {
  const res = await request.get(`${BACKEND}/internal/diag/ext-mcp-stats`);
  if (res.status() !== 200) {
    throw new Error(`ext-mcp-conn-stats: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as ExtMCPStatsResp;
}
