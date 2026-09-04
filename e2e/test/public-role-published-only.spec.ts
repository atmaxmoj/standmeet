// public-role-published-only.spec.ts —— what the public identity reads is exactly what the owner published (F-D-7).
//
// The rule (owner-defined, one sentence): **a private entry cannot be read without a code.**
//
// And "private or not" has a single source of truth: the entry's own `published` toggle
// (`corpus_notes.published`, the one the owner flips on each PUBLIC LANDING card in /admin/wiki). The
// `public` role **must not keep a separate list** restating the same thing —— two copies inevitably
// drift, and no one is notified at the moment they diverge.
//
// This drives the **uninvited visitor** path: a code that specifies no role ("leave blank for public",
// which lands on the same builtin role as codeless BYOAI). The assertion lands on the visitor's own
// agent tool —— `corpus_search` is the visitor's real retrieval surface, not a database peek.
//
// RED (before the fix): both seeded wiki entries came back, because `PublicRoleCorpusURIs` grants
// `wiki://**` —— "everything", regardless of each entry's own toggle.

import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { getRoleByName } from '@/fixtures/roles';
import { test, expect } from '@/fixtures/test';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'publishedonly@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'publishedonly',
  fullName: 'Published Only Owner',
};
const CODE = 'PUBSCOPE-1';
const PUBLISHED_KEY = 'publishedqx';
const UNPUBLISHED_KEY = 'unpublishedqx';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the public identity reads what the owner published — and nothing else', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'published-only-seed');
    const sid = await initMCP(request, token);
    const open = await seedWiki(request, token, sid, {
      title: 'Open Note', body: `a note the owner published about ${PUBLISHED_KEY}`,
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: open.wikiID });
    // Not published —— this is the kind marked `● PRIVATE` in /admin/wiki.
    await seedWiki(request, token, sid, {
      title: 'Held Back Note', body: `a note kept private about ${UNPUBLISHED_KEY}`,
    });
    // **Explicitly** pick builtin `public`: leaving it blank now means `invited` (issuing a code is an
    // invitation). This spec guards "what someone uninvited sees", so that identity must be spelled out
    // and not left to the default.
    const publicRole = await getRoleByName(request, 'public');
    await createCode(request, csrf, {
      code: CODE, label: 'pubscope', assumed_role_id: publicRole.id,
    });
    await request.dispose();
  });

  test('an unpublished entry never reaches a public-identity visitor’s search',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });

      // Run the positive control first: prove the retrieval path works at all, so the 0 below means
      // something ([[assertion-that-cannot-fail]]: an implementation that finds nothing at all would
      // also let the assertion below pass).
      const openHits = await search(request, sess, PUBLISHED_KEY);
      expect(
        openHits.map((h) => h.title),
        'the published entry IS reachable — otherwise the next assertion proves nothing',
      ).toContain('Open Note');

      const heldHits = await search(request, sess, UNPUBLISHED_KEY);
      expect(
        heldHits.map((h) => h.title),
        'an entry the owner never published must not reach a visitor with no invitation',
      ).toEqual([]);
      await request.dispose();
    });
});

async function search(
  request: APIRequestContext, s: VisitorSession, query: string,
): Promise<Array<{ path?: string; title?: string }>> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_search`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { query } },
  );
  // Do not swallow the status code: a rejection and "0 hits found" look identical in the assertion,
  // yet they say completely different things.
  const text = await res.text();
  expect(res.status(), `corpus_search(${query}) answered ${res.status()}: ${text}`).toBe(200);
  // The response is {hits, note?}: note only appears when empty-handed (F-S-2 —— empty is not nothing).
  const body = JSON.parse(text) as
    { result?: { hits?: Array<{ path?: string; title?: string }> } };
  return body.result?.hits ?? [];
}
