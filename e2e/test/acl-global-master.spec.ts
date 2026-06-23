// acl-global-master.spec.ts —— §B.2 of capability-acl-hierarchy-tests.md.
//
// global（capability_settings，活）是顶层 ban master：关了盖过下面一切；开了由
// frozen（role ∧ ¬code_deny）定。验「只减不增」—— global 不能凭空开 role 没授的。
//
// acl-global-beats-role-grant 不用 code-deny（纯 Phase H global + role），多半已绿，
// 作 hierarchy 的 global-layer 回归锁；acl-global-on-frozen-decides 红 until code-deny。

import { test, expect } from '@/fixtures/test';

import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { setCapabilityEnabled } from '@/fixtures/capabilities';
import { setCodeCapabilityDenial } from '@/fixtures/code-denials';
import { OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const CAP = 'calendar.book';

test.describe('ACL §B.2 · global is the top ban master', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerGCalConnected(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });
  // global 是 owner-wide + 活，跨 test 残留 → 每个 test 末尾恢复 enabled=true。
  test.afterEach(async () => {
    await setCapabilityEnabled(seed.request, seed.csrf, CAP, true);
  });

  test('acl-global-beats-role-grant · global off + role grants + no deny → not exposed', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await setCapabilityEnabled(seed.request, seed.csrf, CAP, false)).toBe(200);
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'gOff',
    });
    await expectCalendarBookExposed(seed.request, v.session_token, false);
  });

  test('acl-global-on-frozen-decides · global on + role grants + code denies → not exposed', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [CAP] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    // global stays ON (default) → frozen (role ∧ ¬code_deny) decides → denied → hidden.
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'gOnDeny',
    });
    await expectCalendarBookExposed(seed.request, v.session_token, false);
  });
});
