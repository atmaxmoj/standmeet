// iam-role-validation.spec.ts — the rejection paths for admin /api/admin/roles:
//   - publicRow cannot be renamed (403 role_builtin_immutable)
//   - publicRow cannot be deleted (403 role_builtin_immutable)
//   - duplicate name for the same owner → 409 role_name_taken
//   - prompt_id belongs to a different owner → 400 bad_request
//   - skill_ids contains one not owned by this owner → 400 bad_request
//   - mcp_server_ids contains one not owned by this owner → 400 bad_request
//
// All of these are backend-layer fallback validation — hiding it in the UI alone
// doesn't defend against an attacker hand-writing curl — so the backend must reject
// these and translate the rejection into a meaningful envelope code.
//
// Note: admin REST needs a session cookie + X-Csrftoken; an APIRequestContext holds
// the cookie, and it's lost once disposed. So each test logs in for itself (cheap,
// just one password hash check) before sending its request.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole, getRoleByName } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'roleval@example.com', password: 'correct-horse-battery-staple',
  handle: 'roleval', fullName: 'Role Validation Owner',
};

const ctx: { publicID: string } = { publicID: '' };

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  const publicRow = await getRoleByName(request, 'public');
  ctx.publicID = publicRow.id;
  await request.dispose();
});

async function authedRequest(
  newCtx: () => Promise<APIRequestContext>,
): Promise<{ request: APIRequestContext; csrf: string }> {
  const request = await newCtx();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

// expectRenameKeepsGrant — renaming only, this role's corpus ACL must stay exactly
// as it was.
async function expectRenameKeepsGrant(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const role = await createRole(request, csrf, {
    name: 'acl-keeper', corpus_uris: ['wiki://public/**'],
  });
  // Precondition: confirm the role really does carry a grant first, otherwise what
  // follows would be checking against nothing.
  expect(role.corpus_uris, 'precondition: the role starts out with a corpus grant')
    .toContain('wiki://public/**');

  // The most ordinary thing the owner's AI does: rename only.
  const res = await request.put(`${BACKEND}/api/admin/roles/${role.id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: 'acl-keeper-renamed' },
  });
  expect([200, 400], 'either it keeps the grant, or it refuses — not a silent wipe')
    .toContain(res.status());
  if (res.status() !== 200) return;

  const after = await getRoleByName(request, 'acl-keeper-renamed');
  expect(
    after.corpus_uris,
    '改个名字没提到 corpus_uris —— 它必须原样留着。清空这个 role 的语料 ACL '
    + '而且报成功，是一次没有回执的授权变更',
  ).toContain('wiki://public/**');
}

// expectEvidenceSwitchSticks — the switch was requested on at create time, so it must
// come out on.
async function expectEvidenceSwitchSticks(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'evidence-on-at-birth', description: '', greeting: '',
      prompt_id: null, corpus_uris: [], skill_ids: [], mcp_server_ids: [],
      require_ghost_evidence: true,
    },
  });
  expect(res.status()).toBe(201);
  const created = await res.json() as { require_ghost_evidence: boolean };
  expect(
    created.require_ghost_evidence,
    '建的时候要求了「答话前必须有引证」，建出来就必须是开的 —— '
    + '收下一个安全开关然后不接线，比不收它更糟',
  ).toBe(true);
}

test.describe('A.3-IAM role REST · builtin + uniqueness', () => {
  test('PUT publicRow with a different name → 403 role_builtin_immutable',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const res = await request.put(`${BACKEND}/api/admin/roles/${ctx.publicID}`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: 'not-public', description: 'try to rename builtin',
          prompt_id: null, corpus_uris: [], skill_ids: [], mcp_server_ids: [],
        },
      });
      expect(res.status()).toBe(403);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('role_builtin_immutable');
      await request.dispose();
    });

  // **An incomplete write must never silently wipe this role's grants** (F-Q-3, the
  // same family as corpus's F-L-57).
  //
  // The MCP schema for `role_update` only requires `role_id` (plus `name`, from
  // decode) — so when the owner's AI says "rename this role", it sends exactly
  // `{role_id, name}`. And `toRoleWriteInput` runs `corpus_uris` / `skill_ids` /
  // `mcp_server_ids` / waypoints / dock_buttons all through `nonNilStrings(...)`
  // (absent → nil → empty array → the whole thing gets replaced), while
  // `require_ghost_evidence` / `gas_metered` are bare bools (absent → false). So
  // **renaming a role empties its corpus ACL, strips its skills, and turns off the
  // "must have citations before answering" safety switch** — and the receipt reports
  // success.
  //
  // On the HTTP side it's a `PUT`, where a full-record replace makes sense (the panel
  // always sends a complete form). The problem is that **the same op is described on
  // the MCP side as a partial-friendly update** — [[test-covers-capability-not-face]].
  //
  // This assertion holds under either fix: either absent means "don't touch it", or
  // the schema lists these fields as required (in which case this call would be
  // rejected). **What happens today — silently wiping and reporting success — is
  // neither.**
  test('renaming a role must not silently strip its ACL and its safety switch',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      await expectRenameKeepsGrant(request, csrf);
      await request.dispose();
    });

  // **Creating a role accepts this safety switch, then throws it away** (F-Q-4).
  // `createRoleRow` populates `repo.CreateRoleInput` with GasMetered, ProviderID,
  // DockButtons... but leaves out `RequireGhostEvidence` (`usecase/roles.go:98` vs.
  // `:189`, the path that touches it). So a role created via
  // `role_create {require_ghost_evidence:true}` comes out with that switch off —
  // and it's the switch that controls "the AI must have citations before it answers".
  //
  // This one was found in passing while doing step ⑤ of F-Q-3 in prod: reading it
  // back from the database showed `f`. The receipt itself is **honest** (it re-reads
  // the database and reports exactly what it finds, false), so this isn't "the
  // receipt lying" — it's **nothing putting what you asked for next to what you got,
  // for anyone to see**.
  test('creating a role with the evidence switch on actually turns it on',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      await expectEvidenceSwitchSticks(request, csrf);
      await request.dispose();
    });

  test('DELETE publicRow → 403 role_builtin_immutable', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.delete(`${BACKEND}/api/admin/roles/${ctx.publicID}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(res.status()).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('role_builtin_immutable');
    await request.dispose();
  });

  test('duplicate role name in same owner → 409 role_name_taken',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      await createRole(request, csrf, { name: 'dup-role' });
      const res = await request.post(`${BACKEND}/api/admin/roles/`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: 'dup-role', description: '', prompt_id: null,
          corpus_uris: [], skill_ids: [], mcp_server_ids: [],
        },
      });
      expect(res.status()).toBe(409);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('role_name_taken');
      await request.dispose();
    });
});

test.describe('A.3-IAM role REST · join ownership validation', () => {
  const BOGUS = '00000000-0000-0000-0000-000000000000';

  test('role with bogus prompt_id → 400 bad_request', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.post(`${BACKEND}/api/admin/roles/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'bad-prompt-role', description: '', prompt_id: BOGUS,
        corpus_uris: [], skill_ids: [], mcp_server_ids: [],
      },
    });
    expect(res.status()).toBe(400);
    await request.dispose();
  });

  test('role with bogus skill_id → 400 bad_request', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.post(`${BACKEND}/api/admin/roles/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'bad-skill-role', description: '', prompt_id: null,
        corpus_uris: [], skill_ids: [BOGUS], mcp_server_ids: [],
      },
    });
    expect(res.status()).toBe(400);
    await request.dispose();
  });

  test('role with bogus mcp_server_id → 400 bad_request', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.post(`${BACKEND}/api/admin/roles/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'bad-mcp-role', description: '', prompt_id: null,
        corpus_uris: [], skill_ids: [], mcp_server_ids: [BOGUS],
      },
    });
    expect(res.status()).toBe(400);
    await request.dispose();
  });
});
