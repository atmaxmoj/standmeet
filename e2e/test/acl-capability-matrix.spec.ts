// acl-capability-matrix.spec.ts — §B.1 (capability target) of capability-acl-hierarchy-tests.md.
//
// e2e version of the pure AND-with-code-deny truth table, target = calendar.book (a
// role-granted capability; GCal is connected to isolate the connector gate). Exhausts
// role-granted? x code-deny? across four rows:
//   A1 grant + no deny -> exposed        A2 grant + deny -> not exposed (code revokes it)
//   A3 no grant + no deny -> not exposed  A4 no grant + deny -> not exposed (idempotent noop)
// Criterion: expectCalendarBookExposed (does /internal/diag/session's tool_specs include
// calendar_book?).
//
// Red until: the code_capability_denials table + the admin deny sub-route + applyCodeDenials
// wired into buildRoleSnapshotForCode. Until then setCodeCapabilityDenial gets a 404 -> A2/A4 red.

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
