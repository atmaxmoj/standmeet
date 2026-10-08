// writing-not-leaked.spec.ts —— an unpublished draft and a private writing never reach someone the
// owner did not let in.
//
// Found by the outbound-surface inventory (2026-10-08): the public `GET /api/v1/writings/{slug}`
// looked a writing up with no published filter and always sent `body_md`, so a draft was readable
// by anyone who guessed its slug, and a published writing marked `visibility: private` sent its whole
// body (the reader's LockedView only locks when the body comes back empty — it never did). The same
// "published" flag fed the visitor ACL, so a codeless public session could `corpus_read` /
// `corpus_search` a private writing too.
//
// What a private writing is for (writings/[slug]/page.tsx): anonymous readers get the locked view
// (title + teaser); a code whose role grants it reads it through the visitor tools.
//
// Black box: every check searches what the caller actually receives for a unique marker.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'writing-leak@example.com', password: 'correct-horse-battery-staple',
  handle: 'writingleak', fullName: 'Writing Leak Owner',
};
const CODE = 'WRITINGLEAK-001';
const DRAFT = { slug: 'draft-note', marker: 'DRAFTMARKERQZX' };
const PRIVATE = { slug: 'private-note', marker: 'PRIVMARKERQZX', teaser: 'A teaser anyone may read.' };
const PUBLIC = { slug: 'public-note', marker: 'PUBMARKERQZX' };

let request: APIRequestContext;

const get = async (path: string, token = '') => {
  const res = await request.get(`${BACKEND}${path}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  return { status: res.status(), text: await res.text() };
};

// A direct tool call cold-starts the retrieval sandbox; the product gives block assembly 20s
// (AssembleVisitorBundle), so the harness waits that long rather than the 10s request default.
async function tool(sess: VisitorSession, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${name}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: args, timeout: 25_000 });
  return `${res.status()} ${await res.text()}`;
}

// seed —— an owner, a code on a role that reads every writing, and the three writings.
async function seed(): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'writing-reader', description: 'reads every writing', corpus_uris: ['writing://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'writing reader', assumed_role_id: role.id });
  const token = await createAPIToken(request, csrf, 'writing-leak-seed');
  const sid = await initMCP(request, token);
  const base = { excerpt: 'x', cover_headline: 'x.', cover_hue: 'acid', tags: ['leak'] };
  await callTool(request, token, sid, 'writing_create', {
    ...base, slug: DRAFT.slug, title: 'Draft Note', body_md: `A draft. ${DRAFT.marker}`, publish: false,
  });
  await callTool(request, token, sid, 'writing_create', {
    ...base, slug: PRIVATE.slug, title: 'Private Note', body_md: `Private body. ${PRIVATE.marker}`,
    publish: true, visibility: 'private', locked_body: PRIVATE.teaser,
  });
  await callTool(request, token, sid, 'writing_create', {
    ...base, slug: PUBLIC.slug, title: 'Public Note', body_md: `Public body. ${PUBLIC.marker}`, publish: true,
  });
}

test.describe('writings · a draft or a private writing never reaches an outsider', () => {
  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    await seed();
  });

  test.afterAll(async () => { await request.dispose(); });

  test('anonymous API: a draft answers like a slug that does not exist', async () => {
    const draft = await get(`/api/v1/writings/${DRAFT.slug}`);
    const none = await get('/api/v1/writings/no-such-writing-anywhere');
    expect(draft.text, 'the draft body never leaves').not.toContain(DRAFT.marker);
    expect(draft.status, 'a draft is not found').toBe(none.status);
    expect(none.status).toBe(404);
  });

  test('anonymous API: a private writing gives its teaser, never its body', async () => {
    const one = await get(`/api/v1/writings/${PRIVATE.slug}`);
    expect(one.status).toBe(200);
    expect(one.text, 'the private body never leaves').not.toContain(PRIVATE.marker);
    expect(one.text, 'the teaser is what an outsider reads').toContain(PRIVATE.teaser);

    const list = await get('/api/v1/writings');
    expect(list.text, 'positive control: the public writing is listed').toContain(PUBLIC.marker);
    expect(list.text, 'the list carries no private body').not.toContain(PRIVATE.marker);
    expect(list.text, 'the list carries no draft').not.toContain(DRAFT.marker);
  });

  test('the reader page: locked view for the private writing, not found for the draft',
    async ({ page }) => {
      // What a crawler gets: the server-rendered HTML of the page itself.
      const crawl = await page.request.get(`/writings/${PRIVATE.slug}`);
      expect(await crawl.text(), 'the page HTML carries no private body').not.toContain(PRIVATE.marker);
      const draft = await page.request.get(`/writings/${DRAFT.slug}`);
      expect(draft.status(), 'the draft page is not found').toBe(404);
      expect(await draft.text()).not.toContain(DRAFT.marker);

      // What a reader sees: the locked view — title + teaser, no article body.
      await openReader(page, `/writings/${PRIVATE.slug}`);
      await expect(page.getByText(PRIVATE.teaser)).toBeVisible();
      await expect(page.getByTestId('writing-article-body')).toHaveCount(0);
    });

  test('a codeless public session cannot read or search the private writing', async () => {
    test.setTimeout(150_000); // six tool calls, each may cold-start the sandbox
    const pub = await issueSession(request, { handle: OWNER.handle, mode: 'public' });
    // Positive controls for both tools: if the block failed to bind, these go red instead of the
    // "not.toContain" checks below passing on an error body.
    expect(await tool(pub, 'corpus_read', { path: `writings/${PUBLIC.slug}` }),
      'positive control: the public writing reads').toContain(PUBLIC.marker);
    expect(await tool(pub, 'corpus_search', { query: PUBLIC.marker }),
      'positive control: the public writing is found').toContain(`writings/${PUBLIC.slug}`);

    expect(await tool(pub, 'corpus_read', { path: `writings/${PRIVATE.slug}` })).not.toContain(PRIVATE.marker);
    expect(await tool(pub, 'corpus_search', { query: PRIVATE.marker })).not.toContain(PRIVATE.slug);
    expect(await tool(pub, 'corpus_read', { path: `writings/${DRAFT.slug}` })).not.toContain(DRAFT.marker);
  });

  test('a code whose role grants writings reads the private one', async () => {
    test.setTimeout(90_000);
    const sess = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'R' });
    expect(await tool(sess, 'corpus_read', { path: `writings/${PRIVATE.slug}` }),
      'the invited reader gets the private body').toContain(PRIVATE.marker);
  });
});
