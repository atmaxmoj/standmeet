// iam-role-validation.spec.ts —— admin /api/admin/roles 的拒绝路径：
//   - publicRow 不可改名（403 role_builtin_immutable）
//   - publicRow 不可删（403 role_builtin_immutable）
//   - 同 owner 重 name → 409 role_name_taken
//   - prompt_id 不属于同 owner → 400 bad_request
//   - skill_ids 含非 owner 的 → 400 bad_request
//   - mcp_server_ids 含非 owner 的 → 400 bad_request
//
// 都是 backend layer 的兜底校验，UI 直接 hide 也防御不到 attacker 手写 curl，
// 所以 backend 必须挡且翻译成有意义 envelope code。
//
// 注意：admin REST 要 session cookie + X-Csrftoken；APIRequestContext 持
// cookie，dispose 后就丢。所以每个 test 自己 login（cheap，就一次 hash 验密）
// 再发请求。

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

// expectRenameKeepsGrant —— 只改名字，这个 role 的语料 ACL 必须原样留着。
async function expectRenameKeepsGrant(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const role = await createRole(request, csrf, {
    name: 'acl-keeper', corpus_uris: ['wiki://public/**'],
  });
  // 前置条件：先确认这个 role 真的带着授权，否则下面判的是空气。
  expect(role.corpus_uris, 'precondition: the role starts out with a corpus grant')
    .toContain('wiki://public/**');

  // owner 的 AI 做的那件最普通的事：只改名字。
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

// expectEvidenceSwitchSticks —— 建的时候要求了这个开关，建出来就得是开的。
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

  // **一次不完整的写入不许悄悄清掉这个 role 的授权**（F-Q-3，跟 corpus 的 F-L-57 同一族）。
  //
  // `role_update` 的 MCP schema 只要求 `role_id`（外加 decode 里的 `name`）—— 所以 owner 的 AI
  // 说一句「把这个角色改个名」发的就是 `{role_id, name}`。而 `toRoleWriteInput` 把
  // `corpus_uris` / `skill_ids` / `mcp_server_ids` / waypoints / dock_buttons 一律
  // `nonNilStrings(...)`（缺席 → nil → 空数组 → 整份替换），`require_ghost_evidence` /
  // `gas_metered` 是裸 bool（缺席 → false）。于是**改个名字把这个角色的语料 ACL 清空、
  // 技能摘掉、并把「答话前必须有引证」这条安全开关关掉**，回执报成功。
  //
  // HTTP 那一面是 `PUT`，整份替换在那儿说得通（面板永远发完整表单）。问题在于**同一个 op
  // 在 MCP 那一面被描述成一次 partial-friendly 的 update**——[[test-covers-capability-not-face]]。
  //
  // 这条断言在两种修法下都成立：要么缺席 = 不动，要么 schema 把这几样列进 required（那样这次
  // 调用会被拒）。**今天这样——静默清空并报成功——两种都不是。**
  test('renaming a role must not silently strip its ACL and its safety switch',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      await expectRenameKeepsGrant(request, csrf);
      await request.dispose();
    });

  // **建 role 时收下了这个安全开关，然后扔掉**（F-Q-4）。`createRoleRow` 往
  // `repo.CreateRoleInput` 里塞了 GasMetered、ProviderID、DockButtons…… 唯独漏了
  // `RequireGhostEvidence`（`usecase/roles.go:98` vs 改那条路的 `:189`）。于是
  // `role_create {require_ghost_evidence:true}` 建出来的 role，这个开关是关的 ——
  // 而它管的是「AI 答话前必须先有引证」。
  //
  // 这条是在 prod 上做 F-Q-3 的 ⑤ 时顺手撞见的：库里读回来是 `f`。
  // 回执本身是**诚实**的（它重读了库，回的就是 false），所以这不是"回执撒谎"，
  // 是**没有任何东西把「你要的」和「你得到的」放在一起给人看**。
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
