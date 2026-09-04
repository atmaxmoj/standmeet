// subjectivity-genre.spec.ts —— target-state red test (all red for now: subjectivity has zero code).
//
// subjectivity is the 4th genre on corpus_notes —— the owner's self-model (prose notes: taste/judgement/
// what they care about). Structurally isomorphic to wiki (tree + path derivation + `[[link]]` +
// owner-gated ACL), semantically a self-model rather than knowledge. This suite proves "the genre
// dimension is truly generic": subjectivity as a working genre all-green = the base is not hard-coded to 3.
//
// Target interface (this test drives its implementation):
//   - owner MCP tool `subjectivity_write` {title, body, parent_id?, tags?} → {subjectivity_id, path}
//     (aligned with the shape of promote_to_wiki / writing_create; owner-only, MCP = owner).
//   - addressed by `subjectivity://<path>`, path derived from the tree (same as wiki). Visitor
//     corpus_read/corpus_search go through it.
//   - ACL: role.corpus_uris granting `subjectivity://…` → readable/searchable; ungranted → access denied
//     (same as wiki, owner decides).
//
// Coverage: happy (create/read/search/nesting) · corner (same path different genre do not collide) ·
//       error (ungranted denied · cross-genre ACL · cycle denied · parent missing).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'subjectivity@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'subjectivity',
  fullName: 'Subjectivity Owner',
};
const GRANTED = 'SUBJ-GRANT';
const WIKIONLY = 'SUBJ-WIKIONLY';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MISSING = '00000000-0000-0000-0000-000000000000';

let token = '';
let sid = '';

type Ctx = { playwright: Playwright };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('subjectivity — a 4th genre on corpus_notes (owner self-model)', () => {
  test.beforeAll(seedOwnerAndRoles);

  test('happy: owner writes subjectivity → granted visitor reads it at subjectivity://path', happyRead);
  test('happy: subjectivity note surfaces in corpus_search', happySearch);
  test('happy: nested subjectivity note → path derives from the tree', happyNested);
  test('happy: owner updates a subjectivity note → visitors read the new body', happyUpdate);
  test('happy: owner deletes a subjectivity note → it no longer resolves', happyDelete);
  test('corner: subjectivity + wiki may share a path (genre-scoped, no collision)', cornerSharedPath);
  test('error: a wiki-only role is DENIED subjectivity (owner-gated, same ACL as wiki)', errorAclDeny);
  test('error: reparent a subjectivity node under its own descendant → cycle rejected', errorCycle);
  test('error: write under a non-existent parent → parent-not-found rejected', errorMissingParent);
});

async function seedOwnerAndRoles({ playwright }: Ctx): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'subj-seed');
  sid = await initMCP(request, token);
  const grantRole = await createRole(request, csrf, {
    name: 'subj-role', description: 'subjectivity://**', corpus_uris: ['subjectivity://**'],
  });
  await createCode(request, csrf, { code: GRANTED, label: 's', assumed_role_id: grantRole.id });
  const wikiRole = await createRole(request, csrf, {
    name: 'subj-wiki-only', description: 'wiki://** only', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, { code: WIKIONLY, label: 'k', assumed_role_id: wikiRole.id });
  await request.dispose();
}

// ─── happy ──────────────────────────────────────────────────────
async function happyRead({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await writeSubjectivity(request, 'How I Decide', 'I optimize for reversibility over speed.');
  const sess = await session(request, GRANTED);
  const read = await corpusRead(request, sess, 'how-i-decide');
  expect(read.error, 'granted visitor can read subjectivity').toBeUndefined();
  expect(read.genre, 'resolves as the subjectivity genre').toBe('subjectivity');
  expect(read.body ?? '').toContain('reversibility');
  await request.dispose();
}

async function happySearch({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await writeSubjectivity(request, 'What I Distrust', 'I distrust unfalsifiable claims — subjkw.');
  const sess = await session(request, GRANTED);
  const hits = await corpusSearch(request, sess, 'subjkw');
  expect(hits.some((h) => h.path === 'what-i-distrust'), 'search finds subjectivity').toBe(true);
  await request.dispose();
}

async function happyNested({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const parent = await writeSubjectivity(request, 'Taste', 'parent node');
  await writeSubjectivity(request, 'In Code', 'small diffs, boring tech', parent.subjectivity_id);
  const sess = await session(request, GRANTED);
  const read = await corpusRead(request, sess, 'taste/in-code');
  expect(read.body ?? '', 'nested path resolves').toContain('boring tech');
  await request.dispose();
}

async function happyUpdate({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const n = await writeSubjectivity(request, 'Evolving View', 'first take');
  await writeSubjectivity(request, 'Evolving View', 'revised take', undefined, n.subjectivity_id);
  const sess = await session(request, GRANTED);
  const read = await corpusRead(request, sess, 'evolving-view');
  expect(read.body ?? '', 'update replaced the body').toContain('revised take');
  expect(read.body ?? '', 'old body gone').not.toContain('first take');
  await request.dispose();
}

async function happyDelete({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const n = await writeSubjectivity(request, 'Transient', 'ephemeral');
  await deleteSubjectivity(request, n.subjectivity_id);
  const sess = await session(request, GRANTED);
  const read = await corpusRead(request, sess, 'transient');
  expect(read.error ?? '', 'deleted subjectivity no longer resolves').toMatch(/not found|access denied/i);
  await request.dispose();
}

// ─── corner ─────────────────────────────────────────────────────
async function cornerSharedPath({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seedWiki(request, token, sid, { title: 'Judgment', body: 'wiki body' });
  await writeSubjectivity(request, 'Judgment', 'subjectivity body about judgment');
  const sess = await session(request, GRANTED); // granted subjectivity://** only
  const subj = await corpusRead(request, sess, 'judgment');
  expect(subj.genre, 'granted-subjectivity role resolves the subjectivity one').toBe('subjectivity');
  expect(subj.body ?? '').toContain('subjectivity body');
  await request.dispose();
}

// ─── error ──────────────────────────────────────────────────────
async function errorAclDeny({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await writeSubjectivity(request, 'Private Stance', 'only owner-granted eyes');
  const sess = await session(request, WIKIONLY);
  const read = await corpusRead(request, sess, 'private-stance');
  expect(read.error ?? '', 'subjectivity denied without a subjectivity:// grant')
    .toContain('access denied');
  await request.dispose();
}

async function errorCycle({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const a = await writeSubjectivity(request, 'Cycle A', 'a');
  const b = await writeSubjectivity(request, 'Cycle B', 'b', a.subjectivity_id);
  await expect(
    writeSubjectivity(request, 'Cycle A', 'a', b.subjectivity_id, a.subjectivity_id),
    'moving A under its child B is a cycle',
  ).rejects.toThrow(/cycle/i);
  await request.dispose();
}

async function errorMissingParent({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await expect(
    writeSubjectivity(request, 'Orphan', 'x', MISSING),
  ).rejects.toThrow(/parent .*not found/i);
  await request.dispose();
}

// ─── helpers ────────────────────────────────────────────────────
// writeSubjectivity —— owner MCP `subjectivity_write`. When updateID is given, it is a reparent/update.
async function writeSubjectivity(
  request: APIRequestContext, title: string, body: string,
  parentID?: string, updateID?: string,
): Promise<{ subjectivity_id: string; path: string }> {
  const args: Record<string, unknown> = { title, body, tags: [] };
  if (parentID !== undefined) args['parent_id'] = parentID;
  if (updateID !== undefined) args['subjectivity_id'] = updateID;
  return await callTool<{ subjectivity_id: string; path: string }>(
    request, token, sid, 'subjectivity_write', args,
  );
}

// deleteSubjectivity —— owner admin delete（drives DELETE /api/admin/corpus/subjectivity/{id}）。
async function deleteSubjectivity(request: APIRequestContext, id: string): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.delete(`${BACKEND}/api/admin/corpus/subjectivity/${id}`, { headers: { 'X-Csrftoken': csrf } });
}

async function session(request: APIRequestContext, code: string): Promise<VisitorSession> {
  return issueSession(request, { handle: OWNER.handle, code, visitor_name: 'V' });
}

interface ReadResult { body?: string; genre?: string; error?: string }
async function corpusRead(
  request: APIRequestContext, s: VisitorSession, path: string,
): Promise<ReadResult> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: ReadResult };
  return body.result ?? {};
}
async function corpusSearch(
  request: APIRequestContext, s: VisitorSession, query: string,
): Promise<Array<{ path?: string; title?: string }>> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_search`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { query } },
  );
  // corpus_search's result is the SearchResult receipt `{ hits, note? }`, not a bare array
  // (see fixtures/retrieval.ts) — read .hits, or `.some` runs on the object and throws.
  const body = await res.json() as {
    result?: { hits?: Array<{ path?: string; title?: string }> };
  };
  return body.result?.hits ?? [];
}
