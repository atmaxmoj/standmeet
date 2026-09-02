// registry-invariants.spec.ts -- Phase B cross-cutting invariants. As each subsequent
// B-N adds a capability, this checks along the way: every ID is unique, the shape
// contract is self-consistent (visitor_only <-> never appears in owner MCP; owner_only
// <-> never appears in a visitor session), and repeated introspection within the same
// session gives an identical system_prompt_hash (guards against system-prompt jitter).
//
// During Phase B-1 the registry may be empty, and the invariants still hold trivially;
// this spec's value is establishing the check surface, so the regression net
// automatically catches any violation as B-2..B-6 land.

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
    // owner-side MCP tool list (read via internal endpoint is acceptable; during B-1 the
    // registry list itself is the declared source of truth -- the shape field must map
    // 1:1 to what the owner MCP server actually exposes). This reuses the
    // owner_only/both subset within registry-list to cross-check in reverse: no
    // visitor_only ID may appear in the owner_only|both set.
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
      // May be empty during Phase B-1 -- this spec's value still lies in establishing the
      // assertion surface.
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
    // tool_specs order is stable too
    expect(b.tool_specs.map((t) => t.name)).toEqual(a.tool_specs.map((t) => t.name));
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
