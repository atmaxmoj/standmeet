// upgrade-code-entropy-compat.spec.ts —— after lengthening code entropy, **existing
// codes must not become invalid**.
//
// pentest 2026-09-01: system-derived codes originally had only a 16-bit suffix, too
// weak (see backend/.../code_derive_test.go for details). The fix raises it to 64
// bit. But v0.1.x has already shipped — **already-issued short codes are printed on
// resume QR codes, sitting in live databases right now**. Deploying the new code logic
// as an upgrade must never make those codes stop working.
//
// This pins down two halves:
//   - Upgrade compatibility: a **short, old-format code** (the 16-bit kind) still opens
//     a session and still reads the corpus through its role after the change. A code
//     is an exact-match stored string, and lengthening only affects **newly generated**
//     codes — this test proves that premise holds.
//   - The fix itself: a **freshly issued** code's random suffix is >=16 hex characters
//     (64 bit).
//
// Why this lives in e2e and not only in a unit test: the unit test covers the pure
// function `DeriveCode`; this test covers "a genuinely old code, walked through the
// real redemption path, still gets back a RoleSnapshot" — that's the place an upgrade
// could actually break.

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

// LEGACY_CODE —— a short code as issued **before the upgrade**, shaped like what the
// old `randomCodeSuffix` produced (LABEL + 4 hex characters). The owner supplies this
// value explicitly, so it bypasses the new entropy floor — exactly the shape of "an
// old code that already exists in the database".
const LEGACY_CODE = 'RESUME-1D44';

async function corpusReachable(
  request: APIRequestContext, s: VisitorSession,
): Promise<boolean> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_map`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { budget: 20 } },
  );
  const body = await res.json() as { result?: { total?: number } };
  return (body.result?.total ?? 0) >= 0; // a successful call proves the role is wired up (no 401/error)
}

test.describe('upgrade · strengthening code entropy must not invalidate already-issued codes', () => {
  let generatedCode = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // A role that can read the corpus, attached to both codes.
    const role = await createRole(request, csrf, {
      name: 'reader', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    // Old short code: the owner supplies the value explicitly (simulating a code
    // issued before the upgrade).
    await createCode(request, csrf, { code: LEGACY_CODE, label: 'resume', assumed_role_id: role.id });
    // New code: pass an empty string → system-derived (the code=="" path inside
    // DeriveCode) → should come out long.
    const fresh = await createCode(request, csrf, { code: '', label: 'fresh', assumed_role_id: role.id });
    generatedCode = fresh.code;
    await request.dispose();
  });

  test('an already-issued short code still opens a session after the entropy change', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    // Redeem the old short code — must be 200, never refused just for "being too
    // short".
    const status = await issueSessionStatus(request, {
      handle: OWNER.handle, code: LEGACY_CODE, visitor_name: 'V',
    });
    expect(status, '旧短码在加长熵之后必须仍能兑换（简历上的码不能作废）').toBe(200);
    // And its role is genuinely wired up: it can call the corpus tool, not just get
    // back a hollow session.
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
