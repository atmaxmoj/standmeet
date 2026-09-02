// acl-frozen-product.spec.ts —— §B.3 of capability-acl-hierarchy-tests.md.
//
// When code-deny removes a cap from the grant set before freeze, the whole trail must
// disappear, not just the tool name:
//   1. prompt fragment / part_ids — deny corpus.retrieval → its fragment id drops out of
//      system_prompt_part_ids (the prompt composition changes = the hash changes).
//   2. capability_state — deny a cap a role granted → it is **completely absent** from
//      capabilities[] (**not** enabled=false). "ACL = undiscoverable" is a different lock
//      from the connector/quota/empty-corpus case of "visible but enabled=false degraded"
//      (see the empty-corpus row in retrieval-capability-state).
//
// RED until: applyCodeDenials makes deny act on tool / state / fragment together.

import { test, expect } from '@/fixtures/test';
import type { VisitorSession } from '@/fixtures/visitor';

import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { setCodeCapabilityDenial } from '@/fixtures/code-denials';
import { OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

function partIDs(v: VisitorSession): string[] {
  if (!v.system_prompt_part_ids) throw new Error('response missing system_prompt_part_ids[]');
  return v.system_prompt_part_ids;
}
function capIDs(v: VisitorSession): string[] {
  if (!v.capabilities) throw new Error('response missing capabilities[]');
  return v.capabilities.map((c) => c.id);
}
const hasRetrievalFragment = (v: VisitorSession): boolean =>
  partIDs(v).some((id) => id.includes('retrieval'));

test.describe('ACL §B.3 · code-deny removes the whole frozen product (not just tool name)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerGCalConnected(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('acl-code-deny-drops-prompt-fragment · deny corpus.retrieval → its fragment leaves part_ids', async () => {
    // baseline: role has corpus scope (issueCodeWithSkills role sets corpus_uris) → retrieval active.
    const base = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [] });
    const vBase = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: base.code, visitor_name: 'fragBase',
    });
    expect(hasRetrievalFragment(vBase), 'baseline carries retrieval fragment').toBe(true);

    const denied = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: [] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, denied.id, 'corpus.retrieval')).toBe(201);
    const vDenied = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: denied.code, visitor_name: 'fragDeny',
    });
    expect(hasRetrievalFragment(vDenied), 'denied session drops retrieval fragment').toBe(false);
    // prompt composition differs → hash differs (part_ids is the observable composition).
    expect(partIDs(vDenied)).not.toEqual(partIDs(vBase));
  });

  test('acl-code-deny-cap-absent-from-states · denied cap is ABSENT, not enabled=false', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, { granted_skills: ['calendar.book'] });
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, 'calendar.book')).toBe(201);
    const v = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'stateDeny',
    });
    // "not discovered": calendar.book must not appear in states at all (contrast with
    // connector/quota/empty-corpus which appear with enabled=false).
    expect(capIDs(v)).not.toContain('calendar.book');
  });
});
