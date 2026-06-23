// acl-freeze-isolation.spec.ts —— §C（冻结 vs 活）+ §D（per-code 隔离）.
//
// §C：code 改了**在跑的不动**（role/code issue 时冻结），global 改了**在跑的立刻动**（活）。
// §D：deny 是 per-code 的，不是 per-role —— 同 role 两个 code 各自独立；deny 是集合（多 deny）。
//
// 红 until: code-deny 落地（§C frozen/reissue、§D 全部）；acl-global-live-mid-session 复用
// 现有 capability-disable-while-attached 的活闸，多半已绿（global-layer 回归锁）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { setCapabilityEnabled, sessionToolNames } from '@/fixtures/capabilities';
import { setCodeCapabilityDenial } from '@/fixtures/code-denials';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const CAP = 'calendar.book';
let n = 0;

// roleGrantingBook —— 建一个 skill(allowed_tools=[calendar.book]) + role 挂它 + 有 corpus
// scope（retrieval 活）。返回 role id。多个 code 可共用它（§D 同 role 两 code）。
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

  test('acl-code-denial-scoped-to-owner · deny on a code not owned by this owner → 4xx', async () => {
    const foreignCodeID = '00000000-0000-0000-0000-000000000000';
    const status = await setCodeCapabilityDenial(seed.request, seed.csrf, foreignCodeID, CAP);
    expect([403, 404]).toContain(status);
  });
});
