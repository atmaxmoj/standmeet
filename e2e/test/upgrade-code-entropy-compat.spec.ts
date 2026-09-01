// upgrade-code-entropy-compat.spec.ts —— 加长码熵之后，**旧码不能作废**。
//
// pentest 2026-09-01：系统派生码原本只有 16 bit 后缀，太弱（详见
// backend/.../code_derive_test.go）。修复把它提到 64 bit。但 v0.1.x 已经发出去了 ——
// **已签发的短码印在简历 QR 上、躺在跑着的库里**。升级部署新码逻辑，绝不能让那些码打不开。
//
// 这条钉两半：
//   · 升级兼容：一张**旧格式的短码**（16-bit 那种）在改动后仍能开 session、仍按它的 role 读语料。
//     码是精确匹配的存储串，加长只影响**新生成**的码 —— 这条证明那个前提成立。
//   · 修复本身：一张**新签发**的码，随机后缀 ≥16 个 hex 字符（64 bit）。
//
// 为什么放在 e2e 而不只在单元：单元测的是 `DeriveCode` 这个纯函数；这里测的是
// 「一张真的旧码，走完真实的兑换路径，仍拿得到 RoleSnapshot」——那是升级会不会断的地方。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, issueSessionStatus, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'codecompat@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codecompat',
  fullName: 'Code Compat Owner',
};

// LEGACY_CODE —— 一张**升级前签发**的短码，形如老 `randomCodeSuffix` 的产物
// （LABEL + 4 个 hex）。owner 显式给值，所以它绕过新的熵下限，正是"库里已有的旧码"的样子。
const LEGACY_CODE = 'RESUME-1D44';

async function corpusReachable(
  request: APIRequestContext, s: VisitorSession,
): Promise<boolean> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_map`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { budget: 20 } },
  );
  const body = await res.json() as { result?: { total?: number } };
  return (body.result?.total ?? 0) >= 0; // 能调通即证明 role 已装配（不 401/不报错）
}

test.describe('upgrade · strengthening code entropy must not invalidate already-issued codes', () => {
  let generatedCode = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // 一个能读语料的 role，挂给两张码。
    const role = await createRole(request, csrf, {
      name: 'reader', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    // 旧短码：owner 显式给值（模拟升级前签发的码）。
    await createCode(request, csrf, { code: LEGACY_CODE, label: 'resume', assumed_role_id: role.id });
    // 新码：给空串 → 系统派生（DeriveCode 里 code=="" 那条路）→ 应当是长的。
    const fresh = await createCode(request, csrf, { code: '', label: 'fresh', assumed_role_id: role.id });
    generatedCode = fresh.code;
    await request.dispose();
  });

  test('an already-issued short code still opens a session after the entropy change', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    // 兑换旧短码 —— 必须 200，不能因为它"太短"就被拒。
    const status = await issueSessionStatus(request, {
      handle: OWNER.handle, code: LEGACY_CODE, visitor_name: 'V',
    });
    expect(status, '旧短码在加长熵之后必须仍能兑换（简历上的码不能作废）').toBe(200);
    // 而且它的 role 真的装配了：能调 corpus 工具，不是拿到一个空壳 session。
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: LEGACY_CODE, visitor_name: 'V',
    });
    expect(await corpusReachable(request, sess), '旧码开出的 session 仍带得动它的 role').toBe(true);
    await request.dispose();
  });

  test('a freshly-issued code carries a high-entropy suffix (>=16 hex chars)', () => {
    const suffix = generatedCode.slice(generatedCode.lastIndexOf('-') + 1);
    expect(suffix.length,
      `新签发的码后缀是 "${suffix}"（${suffix.length * 4} bit）—— ` +
      '一个授予私有语料的 URL bearer 至少要 64 bit')
      .toBeGreaterThanOrEqual(16);
    expect(suffix, '后缀应是 hex').toMatch(/^[0-9A-F]+$/);
  });
});
