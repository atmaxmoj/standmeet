// acl-capability-matrix.spec.ts —— §B.1（capability target）of capability-acl-hierarchy-tests.md.
//
// 纯 AND·code-deny 真值表的 e2e 版，target = calendar.book（role-granted 能力，
// GCal 已连以隔离 connector 闸）。穷尽 role 授? × code deny? 四行：
//   A1 授 + 无 deny → 暴露        A2 授 + deny → 不暴露（code 撤销）
//   A3 不授 + 无 deny → 不暴露     A4 不授 + deny → 不暴露（幂等 noop）
// 判据：expectCalendarBookExposed（/internal/diag/session 的 tool_specs 含 calendar_book?）。
//
// 红 until: code_capability_denials 表 + admin deny 子路由 + applyCodeDenials 接进
// buildRoleSnapshotForCode。在那之前 setCodeCapabilityDenial 拿 404 → A2/A4 红。

import { test, expect } from '@/fixtures/test';

import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { setCodeCapabilityDenial } from '@/fixtures/code-denials';
import { OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const CAP = 'calendar.book';

test.describe('ACL §B.1 · capability deny matrix (calendar.book, GCal connected)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerGCalConnected(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('acl-cap-inherit · role grants, no deny → exposed (A1)', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'A1',
    });
    await expectCalendarBookExposed(seed.request, v.session_token, true);
  });

  test('acl-cap-code-revokes · role grants, code denies → not exposed (A2)', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'A2',
    });
    await expectCalendarBookExposed(seed.request, v.session_token, false);
  });

  test('acl-cap-none · role does not grant, no deny → not exposed (A3)', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [] });
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'A3',
    });
    await expectCalendarBookExposed(seed.request, v.session_token, false);
  });

  test('acl-cap-code-deny-noop · role does not grant, code denies → not exposed (A4)', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [] });
    // deny something the role never granted: idempotent no-op, must not crash.
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'A4',
    });
    await expectCalendarBookExposed(seed.request, v.session_token, false);
  });
});
