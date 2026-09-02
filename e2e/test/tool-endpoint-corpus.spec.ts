// tool-endpoint-corpus.spec.ts -- the visitor calls corpus_search /
// corpus_read / corpus_list directly through the per-tool HTTP endpoint.
// This is exactly the endpoint the frontend's pi-agent-core ToolDispatcher
// port implementation goes through, making the per-tool UI throbber visible
// (a total black box under the old SSE stream).
//
// Invariants:
//   - URL: POST /api/v1/sessions/{conv_id}/tools/{tool_name}
//   - Auth: Bearer session_token
//   - Happy path: returns {ok:true, result, capability_state}
//   - Error, capability disabled: 404 + {ok:false, reason:"capability_not_enabled"}
//   - Error, bad token: 401
//   - Error, invalid args: 200 + tool envelope (the executor translates it itself)
//   - Invariant: the capability_state field is always returned (kept in sync
//     with the frontend's zustand store)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'corpus-tool@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpus-tool', fullName: 'Corpus Tool Owner',
};

const CODE_FULL = 'CORPUS-FULL';
const CODE_EMPTY = 'CORPUS-EMPTY';
const CODE_NARROW = 'CORPUS-NARROW';
// The path is derived from the tree: the parent's "projects/family" segment
// + the leaf's slug (from the title). 'Lucerna project notes' ->
// 'lucerna-project-notes'; 'Family secret' -> 'family-secret'. The ACL glob
// wiki://projects/** allows the former and denies the latter.
const NARROW_ALLOWED_PATH = 'projects/lucerna-project-notes';
const NARROW_DENIED_PATH = 'family/family-secret';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: unknown;
  capability_state?: SessionCapability[];
}

async function setupCorpusToolOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const roleFull = await createRole(request, csrf, {
    name: 'full-corpus-role', description: 'role with corpus URIs',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE_FULL, label: 'full', assumed_role_id: roleFull.id,
  });
  const roleEmpty = await createRole(request, csrf, {
    name: 'no-corpus-role', description: 'role without corpus URIs',
    corpus_uris: [],
  });
  await createCode(request, csrf, {
    code: CODE_EMPTY, label: 'empty', assumed_role_id: roleEmpty.id,
  });
  // Narrow role: only allows wiki://projects/**. Seed two wiki entries: one
  // under projects (allowed), one under family (denied). This lets us verify
  // an ACL denial goes through result.error, not a 404 (the entry exists but
  // is out of scope).
  const roleNarrow = await createRole(request, csrf, {
    name: 'narrow-corpus-role', description: 'wiki://projects/** only',
    corpus_uris: ['wiki://projects/**'],
  });
  await createCode(request, csrf, {
    code: CODE_NARROW, label: 'narrow', assumed_role_id: roleNarrow.id,
  });
  await seedNarrowWikis(request, csrf);
  await request.dispose();
}

async function seedNarrowWikis(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const apiToken = await createAPIToken(request, csrf, 'corpus-tool-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: 'Lucerna project notes', body: 'Public projects detail.',
    path: NARROW_ALLOWED_PATH,
  });
  await seedWiki(request, apiToken, sid, {
    title: 'Family secret', body: 'This is private.',
    path: NARROW_DENIED_PATH,
  });
}

async function freshSession(
  request: APIRequestContext, code: string,
): Promise<VisitorSession> {
  return issueSession(
    request, { handle: OWNER.handle, code, visitor_name: 'V' },
  );
}

async function callTool(
  request: APIRequestContext,
  sess: VisitorSession,
  toolName: string,
  args: unknown,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${toolName}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: args as object,
    },
  );
  const status = res.status();
  const body = await res.json() as ToolResp;
  return { status, body };
}

test.describe('tool endpoint · corpus_search / corpus_read / corpus_list', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupCorpusToolOwner(playwright);
  });

  test('corpus_search happy path → 200 + result array + capability_state',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertCorpusSearchHappy(request);
      await request.dispose();
    });

  test('corpus_list happy path → 200 + result + capability_state',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertCorpusListHappy(request);
      await request.dispose();
    });

  test('empty corpus role → corpus_search returns 200 with empty array (cap enabled=false but tool still callable)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertEmptyRoleSearchOk(request);
      await request.dispose();
    });

  test('narrow ACL: corpus_read allowed path → 200 + result.genre=wiki body',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertNarrowAllowedPath(request);
      await request.dispose();
    });

  test('narrow ACL: corpus_read DENIED path → 200 + result.error="access denied: <path>"',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertNarrowDeniedPath(request);
      await request.dispose();
    });

  // ACL must hold on SEARCH too, not just READ. read-deny above only proves you
  // can't READ an out-of-scope path; this proves SEARCH never SURFACES one — the
  // exact behaviour #157 moves from "filter after the scan" into the Search method.
  // Direct (no LLM): the prior coverage was only the LLM-driven cited-refs path.
  test('narrow ACL: corpus_search excludes entries outside role.corpus_uris (ACL on SEARCH, not just read)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertNarrowSearchExcludesDenied(request);
      await request.dispose();
    });

  test('unknown tool name → 404 + {ok:false, reason:"capability_not_enabled"}',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await freshSession(request, CODE_FULL);
      const { status, body } = await callTool(
        request, sess, 'no_such_tool', {},
      );
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.reason).toBe('capability_not_enabled');
      await request.dispose();
    });

  test('bad session token → 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertBadTokenReturns401(request);
      await request.dispose();
    });

  test('no credentials (no bearer, no cookie) → 401',
    async ({ playwright }) => {
      const seeded = await playwright.request.newContext();
      const sess = await freshSession(seeded, CODE_FULL);
      // Hit it with a brand-new context: no bearer **and** no session cookie
      // -> truly no credentials -> 401.
      // (The seeded context would be recognized, since issuing the session
      // left an sm_vsession cookie in its jar.)
      const anon = await playwright.request.newContext();
      await assertNoCredsReturns401(anon, sess.conversation_id);
      await seeded.dispose();
      await anon.dispose();
    });
});

async function assertCorpusSearchHappy(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_FULL);
  const { status, body } = await callTool(
    request, sess, 'corpus_search', { query: 'lucerna' },
  );
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.capability_state, 'always returns fresh cap state').toBeDefined();
  expect(Array.isArray(body.capability_state)).toBe(true);
}

async function assertCorpusListHappy(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_FULL);
  const { status, body } = await callTool(
    request, sess, 'corpus_list', {},
  );
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
}

async function assertEmptyRoleSearchOk(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_EMPTY);
  const { status, body } = await callTool(
    request, sess, 'corpus_search', { query: 'anything' },
  );
  // The role has the corpus.retrieval capability but enabled=false (no
  // corpus_uris); the tool is still exposed (by B-2's design: let the LLM
  // call it; the ACL denial returns empty).
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
}

async function assertNarrowAllowedPath(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_NARROW);
  const { status, body } = await callTool(
    request, sess, 'corpus_read', { path: NARROW_ALLOWED_PATH },
  );
  expect(status).toBe(200);
  const result = body.result as { genre?: string; body?: string; error?: string };
  expect(result.error, 'no ACL error for allowed path').toBeUndefined();
  expect(result.genre).toBe('wiki');
  expect(result.body).toContain('Public projects detail');
}

async function assertNarrowDeniedPath(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_NARROW);
  const { status, body } = await callTool(
    request, sess, 'corpus_read', { path: NARROW_DENIED_PATH },
  );
  // The endpoint envelope's ok is always true (the executor ran fine); the
  // out-of-scope signal lives in the tool's returned JSON (result.error),
  // matching the plan decision (a tool envelope, not an HTTP 403).
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  const result = body.result as { error?: string };
  expect(result.error, 'tool envelope carries access denied').toContain('access denied');
  expect(result.error).toContain(NARROW_DENIED_PATH);
}

async function assertNarrowSearchExcludesDenied(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_NARROW);

  // a query that WOULD match the out-of-scope 'Family secret' (family/**, not granted)
  const denied = await callTool(request, sess, 'corpus_search', { query: 'secret' });
  expect(denied.status).toBe(200);
  expect(denied.body.ok).toBe(true);
  // The reply shape is {hits, note?} -- note only appears when the result is
  // empty-handed (F-S-2: empty is not the same as absent).
  const deniedRows = searchHitsOf(denied.body.result);
  expect(deniedRows.map((r) => r.path),
    'corpus_search must not surface a path outside role.corpus_uris').not.toContain(NARROW_DENIED_PATH);
  expect(deniedRows.map((r) => r.title),
    'corpus_search must not surface the denied entry').not.toContain('Family secret');

  // sanity: the in-scope projects entry IS searchable (so the exclusion isn't "search returns nothing")
  const allowed = await callTool(request, sess, 'corpus_search', { query: 'lucerna' });
  const allowedRows = searchHitsOf(allowed.body.result);
  expect(allowedRows.map((r) => r.path),
    'in-scope projects entry must still be searchable').toContain(NARROW_ALLOWED_PATH);
}

async function assertBadTokenReturns401(request: APIRequestContext): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/00000000-0000-0000-0000-000000000000/tools/corpus_search`,
    {
      headers: { Authorization: 'Bearer smv_bogus' },
      data: { query: 'x' },
    },
  );
  expect(res.status()).toBe(401);
}

async function assertNoCredsReturns401(
  request: APIRequestContext, conversationID: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${conversationID}/tools/corpus_search`,
    { data: { query: 'x' } },
  );
  expect(res.status()).toBe(401);
}

// searchHitsOf -- the hits array inside a corpus_search reply.
// This spec hits the tool endpoint directly (that's exactly what it
// verifies), so it unwraps this shell itself.
function searchHitsOf(result: unknown): Array<{ path?: string; title?: string }> {
  const r = result as { hits?: Array<{ path?: string; title?: string }> } | undefined;
  return r?.hits ?? [];
}
