// acl-freeze-isolation.spec.ts -- §C (frozen vs live) + §D (per-code isolation).
//
// §C: changing a code does **not** affect an in-flight session (freeze happens at
//     **session** issuance, not code issuance -- see
//     `access/usecase/visitor_session.go:40-42`; acl-code-reissue-reflects below pins
//     exactly this distinction: **reissuing** the same code immediately reflects the
//     new value. This line used to say "frozen at role/code issue time", matching the
//     same wrong wording in three panel copy spots, see F-L-29), changing a global
//     setting affects in-flight sessions immediately (live).
// §D: deny is per-code, not per-role -- two codes on the same role are independent;
//     deny is a set (multiple denials).
//
// RED until: code-deny lands (§C frozen/reissue, all of §D); acl-global-live-mid-session
// reuses the existing capability-disable-while-attached live gate, likely already green
// (global-layer regression lock).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { setCapabilityEnabled, sessionToolNames } from '@/fixtures/capabilities';
import {
  setCodeCapabilityDenial, listCodeDenialsStatus, setCodeCorpusDenials,
} from '@/fixtures/code-denials';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const CAP = 'calendar.book';
let n = 0;

// roleGrantingBook -- builds a skill(allowed_tools=[calendar.book]) + attaches a role to
// it + a corpus scope (retrieval live). Returns the role id. Multiple codes can share it
// (§D: two codes on the same role).
async function roleGrantingBook(req: APIRequestContext, csrf: string): Promise<string> {
  n += 1;
  const sk = await req.post(`${BACKEND}/api/admin/skills/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: `acl-bk-${n}`, description: 'book skill', prompt: 'b', allowed_tools: [CAP] },
  });
  if (sk.status() !== 201) throw new Error(`skill: ${sk.status()}`);
  const skillID = (await sk.json() as { id: string }).id;
  const role = await createRole(req, csrf, {
    name: `acl-role-${n}`, description: 'grants book', skill_ids: [skillID],
    corpus_uris: ['wiki://**', 'output://**'],
  });
  return role.id;
}

async function codeOnRole(req: APIRequestContext, csrf: string, roleID: string): Promise<{ id: string; code: string }> {
  n += 1;
  return createCode(req, csrf, { code: `ACLFI-${n}`, label: `fi-${n}`, assumed_role_id: roleID });
}

test.describe('ACL §C/§D · freeze-vs-live + per-code isolation', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerGCalConnected(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });
  test.afterEach(async () => { await setCapabilityEnabled(seed.request, seed.csrf, CAP, true); });

  test('acl-code-frozen-at-issue · deny after issue does NOT affect the running session', async () => {
    const role = await roleGrantingBook(seed.request, seed.csrf);
    const code = await codeOnRole(seed.request, seed.csrf, role);
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'frozen' });
    await expectCalendarBookExposed(seed.request, v.session_token, true);
    // mutate code deny AFTER issue → frozen snapshot must not re-read it.
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    await expectCalendarBookExposed(seed.request, v.session_token, true);
  });

  test('acl-code-reissue-reflects · same code, deny → a NEW issue reflects it', async () => {
    const role = await roleGrantingBook(seed.request, seed.csrf);
    const code = await codeOnRole(seed.request, seed.csrf, role);
    const before = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'before' });
    await expectCalendarBookExposed(seed.request, before.session_token, true);
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    const after = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'after' });
    await expectCalendarBookExposed(seed.request, after.session_token, false);
    // and the earlier session is still frozen-exposed (re-assert isolation of freeze).
    await expectCalendarBookExposed(seed.request, before.session_token, true);
  });

  test('acl-global-live-mid-session · global disable hides it from a running session immediately', async () => {
    const role = await roleGrantingBook(seed.request, seed.csrf);
    const code = await codeOnRole(seed.request, seed.csrf, role);
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'live' });
    await expectCalendarBookExposed(seed.request, v.session_token, true);
    expect(await setCapabilityEnabled(seed.request, seed.csrf, CAP, false)).toBe(200);
    await expectCalendarBookExposed(seed.request, v.session_token, false); // live, mid-session
  });

  test('acl-code-isolation · same role, two codes; deny on code-1 only', async () => {
    const role = await roleGrantingBook(seed.request, seed.csrf);
    const code1 = await codeOnRole(seed.request, seed.csrf, role);
    const code2 = await codeOnRole(seed.request, seed.csrf, role);
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code1.id, CAP)).toBe(201);
    const v1 = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code1.code, visitor_name: 'iso1' });
    const v2 = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code2.code, visitor_name: 'iso2' });
    await expectCalendarBookExposed(seed.request, v1.session_token, false); // denied
    await expectCalendarBookExposed(seed.request, v2.session_token, true);  // sibling untouched
  });

  test('acl-code-multi-deny · one code denies two caps → both gone', async () => {
    const role = await roleGrantingBook(seed.request, seed.csrf);
    const code = await codeOnRole(seed.request, seed.csrf, role);
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, CAP)).toBe(201);
    expect(await setCodeCapabilityDenial(seed.request, seed.csrf, code.id, 'corpus.retrieval')).toBe(201);
    const v = await issueSession(seed.request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'multi' });
    const tools = await sessionToolNames(seed.request, v.session_token);
    expect(tools).not.toContain('calendar_book');
    expect(tools).not.toContain('corpus_search');
  });

  // A code's ACL belongs to the owner: **read, write, and full replace** must all ask
  // "is this code yours?" first.
  // Testing only the write path isn't enough -- the ownership check has been missed once
  // before, and the way it was missed was exactly "one path forgot to ask".
  // A nonexistent id and someone else's id must give the same answer: otherwise this
  // endpoint becomes a probe for "does this id exist?".
  test('acl-code-denial-scoped-to-owner · a code not owned by this owner is 4xx on every ACL path',
    async () => {
      const foreign = '00000000-0000-0000-0000-000000000000';

      const write = await setCodeCapabilityDenial(seed.request, seed.csrf, foreign, CAP);
      expect([403, 404], `write denial: got ${write}`).toContain(write);

      const read = await listCodeDenialsStatus(seed.request, seed.csrf, foreign);
      expect([403, 404], `read denials: got ${read}`).toContain(read);

      const replace = await setCodeCorpusDenials(seed.request, seed.csrf, foreign, ['wiki://**']);
      expect([403, 404], `replace corpus denials: got ${replace}`).toContain(replace);
    });
});
