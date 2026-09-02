// b5-owner-only-isolation.spec.ts —— Phase B-5: verifies that every owner-only
// capability (owner.me / seo.bundle / and the jobs / resume / applications /
// custom_page ones migrated in later) is absent from a visitor session's
// capability map and tool_specs.
//
// The existing registry-invariants spec already covers the visitor_only ↔ no
// owner MCP side. This spec hardens the reverse direction: enumerate every
// owner-only ID and every tool name its OwnerMCPBinding exposes, and make
// sure none of them leaked to the visitor side.

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

  // This case used to name owner.me + seo.bundle as sentinels. Once they moved into the
  // outbound convergence point, they weren't in capreg anymore, so this case would go red
  // purely because of a **relocation** — but what it actually guards isn't those two names,
  // it's "not one thing the owner can do leaks to a visitor." So it now compares against the
  // **whole owner tool surface** instead; nothing relocating changes what it guards.
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

// ownerSurfaceStaysOwnerSide —— every tool the owner can call through a real MCP client
// must not show up in the visitor's tool_specs. This compares the **whole surface**, not a
// hand-copied list of names: a hand-copied list only grows when someone remembers to extend it.
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
