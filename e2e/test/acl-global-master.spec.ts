// acl-global-master.spec.ts —— §B.2 of capability-acl-hierarchy-tests.md.
//
// global (capability_settings, live) is the top-level ban master: off overrides
// everything below it; on defers to frozen (role ∧ ¬code_deny). Verifies "can only
// narrow, never widen" — global can't open up something role never granted.
//
// acl-global-beats-role-grant doesn't use code-deny (pure Phase H global + role), so
// it's likely already green; it acts as the hierarchy's global-layer regression lock.
// acl-global-on-frozen-decides is red until code-deny lands.

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
  // global is owner-wide and live, so it persists across tests — restore
  // enabled=true at the end of every test.
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
