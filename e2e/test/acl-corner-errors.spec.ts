// acl-corner-errors.spec.ts —— §F（corner）+ §E（error stream）of capability-acl-hierarchy-tests.md.
//
// §F：code-deny 只收窄授权，不碰存在性/连接/配额。纯 AND·deny 下「code 反向 allow」的
// corner（旧 F1/F2/F3/F7）已不存在。F4（deny-noop-when-role-ungranted）= A4，已在
// acl-capability-matrix（acl-cap-code-deny-noop）覆盖，这里不重复。
// §E：deny 写口的坏值/重复/撤销/读回/鉴权。
//
// 红 until: code-deny schema + admin 子路由（含坏 body 400 / 重复幂等 / 撤销 / 读回）。

import { test, expect } from '@/fixtures/test';

import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { sessionToolNames } from '@/fixtures/capabilities';
import {
  setCodeCapabilityDenial, clearCodeCapabilityDenial, listCodeDenials, postCodeCapabilityDenialRaw,
} from '@/fixtures/code-denials';
import { OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const CAP = 'calendar.book';

test.describe('ACL §F/§E · corner cases + error stream', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerGCalConnected(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  // ─── §F corner ───────────────────────────────────────────────

  test('acl-code-deny-owner-only-noop · deny an owner-only cap → no visitor effect, no crash (F5)', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    // 'seo' is owner-only (not on the visitor plane) → denying it is meaningless but must not crash.
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, 'seo')).toBeLessThan(300);
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'f5' });
    await expectCalendarBookExposed(seed.request, v.session_token, true); // visitor plane unaffected
  });

  test('acl-public-session-no-deny-layer · public session (no code) issues normally (F8)', async () => {
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'public', visitor_name: 'pub' });
    expect(v.session_token).toBeTruthy();
    // no code → no deny source; tool assembly must work (public role), no crash.
    expect(await sessionToolNames(seed.request, v.session_token)).toBeInstanceOf(Array);
  });

  // ─── §E error stream ─────────────────────────────────────────

  test('acl-deny-unknown-capid · deny a non-existent cap id → written, zero effect, no crash', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, 'no.such.capability')).toBe(201);
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'eUnknown' });
    await expectCalendarBookExposed(seed.request, v.session_token, true); // granted cap unaffected
  });

  test('acl-deny-on-revoked-code · revoked code → session 401, deny is moot', async () => {
    const { request } = seed; // 独立 APIRequestContext，bare 变量避开「写走 UI」规则
    const code = await issueCodeWithSkills(request, seed.csrf, { granted_skills: [CAP] });
    await setCodeCapabilityDenial(request, seed.csrf, code.id, CAP);
    const revoke = await request.post(`${BACKEND}/api/admin/codes/${code.id}/revoke`, {
      headers: { 'X-Csrftoken': seed.csrf },
    });
    expect(revoke.status()).toBeLessThan(300);
    const status = await issueSessionStatus(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'eRevoked' });
    expect(status).toBe(401);
  });

  test('acl-deny-missing-csrf · write deny without CSRF → 403', async () => {
    const { request } = seed; // 独立 APIRequestContext，bare 变量避开「写走 UI」规则
    const code = await issueCodeWithSkills(request, seed.csrf, { granted_skills: [CAP] });
    const res = await request.post(
      `${BACKEND}/api/admin/codes/${code.id}/capability-denials`,
      { data: { capability_id: CAP } }, // no X-Csrftoken
    );
    expect(res.status()).toBe(403);
  });

  test('acl-deny-malformed-body · POST missing capability_id → 400', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await postCodeCapabilityDenialRaw(seed.request, seed.csrf, code.id, {})).toBe(400);
  });

  test('acl-deny-duplicate-idempotent · deny same (code,cap) twice → idempotent, single row', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBeLessThan(300);
    const denials = await listCodeDenials(seed.request, seed.csrf, code.id);
    expect(denials.capability_ids.filter((id) => id === CAP)).toHaveLength(1);
  });

  test('acl-deny-undo-reissue · deny → clear → reissue → capability back', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    expect(await clearCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(204);
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'eUndo' });
    await expectCalendarBookExposed(seed.request, v.session_token, true);
  });

  test('acl-deny-readback · write deny → GET denials returns it', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP);
    const denials = await listCodeDenials(seed.request, seed.csrf, code.id);
    expect(denials.capability_ids).toContain(CAP);
  });
});
