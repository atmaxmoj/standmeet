// acl-skill-matrix.spec.ts —— §B.1（skill target）of capability-acl-hierarchy-tests.md.
//
// How a skill surfaces = L1 injects the name+description of every skill the
// role grants and enables into the system prompt (the SkillPrompts channel in
// ComposeBasePersona). So the skill ACL check is: is that skill's description
// marker present in /internal/diag/session's system_prompt_full (and does the
// hash change)?
//   A1 · skill granted + no deny → present     A2 · skill granted + deny → absent (code revokes it)
//   A3 · skill not granted (no role) → absent (baseline)
//
// RED until code_skill_denials + applyCodeDenials subtract from SkillIDs.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { setCodeSkillDenial } from '@/fixtures/code-denials';
import { OWNER, seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MARKER = 'ACL-SKILL-L1-MARKER-7f3a';
const HANDLE = OWNER.handle;

async function createSkill(req: APIRequestContext, csrf: string, name: string, desc: string): Promise<string> {
  const res = await req.post(`${BACKEND}/api/admin/skills/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name, description: desc, prompt: 'fixture body', allowed_tools: [] },
  });
  if (res.status() !== 201) throw new Error(`create skill: ${res.status()}`);
  return (await res.json() as { id: string }).id;
}

async function diagPrompt(req: APIRequestContext, token: string): Promise<{ full: string; hash: string }> {
  const res = await req.get(`${BACKEND}/internal/diag/session`, { headers: { 'X-Session-Token': token } });
  if (res.status() !== 200) throw new Error(`diag session: ${res.status()}`);
  const b = await res.json() as { system_prompt_full: string; system_prompt_hash: string };
  return { full: b.system_prompt_full, hash: b.system_prompt_hash };
}

test.describe('ACL §B.1 · skill deny matrix (L1 name/description injection)', () => {
  let seed: BaseSeed;
  let skillID = '';
  let roleWithID = '';
  let roleWithoutID = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    skillID = await createSkill(seed.request, seed.csrf, 'acl-skill', `desc ${MARKER}`);
    roleWithID = (await createRole(seed.request, seed.csrf, {
      name: 'role-with-skill', description: 'attaches the skill', skill_ids: [skillID],
    })).id;
    roleWithoutID = (await createRole(seed.request, seed.csrf, {
      name: 'role-without-skill', description: 'no skill', skill_ids: [],
    })).id;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('acl-skill-inherit · role grants, no deny → L1 marker present (A1·skill)', async () => {
    const code = await createCode(seed.request, seed.csrf, {
      code: 'ACLSK-INHERIT', label: 'inherit', assumed_role_id: roleWithID,
    });
    const v = await issueSession(seed.request, { handle: HANDLE, mode: 'code', code: code.code, visitor_name: 'sk1' });
    expect((await diagPrompt(seed.request, v.session_token)).full).toContain(MARKER);
  });

  test('acl-skill-code-revokes · role grants, code denies → L1 marker absent + hash changes (A2·skill)', async () => {
    const granted = await createCode(seed.request, seed.csrf, {
      code: 'ACLSK-GRANTED', label: 'granted', assumed_role_id: roleWithID,
    });
    const vGranted = await issueSession(seed.request, { handle: HANDLE, mode: 'code', code: granted.code, visitor_name: 'skG' });
    const hashGranted = (await diagPrompt(seed.request, vGranted.session_token)).hash;

    const denied = await createCode(seed.request, seed.csrf, {
      code: 'ACLSK-DENIED', label: 'denied', assumed_role_id: roleWithID,
    });
    expect(await setCodeSkillDenial(seed.request, seed.csrf, denied.id, skillID)).toBe(201);
    const vDenied = await issueSession(seed.request, { handle: HANDLE, mode: 'code', code: denied.code, visitor_name: 'skD' });
    const { full, hash } = await diagPrompt(seed.request, vDenied.session_token);
    expect(full).not.toContain(MARKER);
    expect(hash).not.toBe(hashGranted);
  });

  test('acl-skill-none · skill not attached to role → L1 marker absent (A3·skill baseline)', async () => {
    const code = await createCode(seed.request, seed.csrf, {
      code: 'ACLSK-NONE', label: 'none', assumed_role_id: roleWithoutID,
    });
    const v = await issueSession(seed.request, { handle: HANDLE, mode: 'code', code: code.code, visitor_name: 'skN' });
    expect((await diagPrompt(seed.request, v.session_token)).full).not.toContain(MARKER);
  });
});
