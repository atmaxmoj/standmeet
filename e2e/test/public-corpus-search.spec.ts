// public-corpus-search.spec.ts —— the owner opts an ANONYMOUS visitor into searching their
// PUBLISHED corpus, from a corpus_search BlockWidget on a public microsite, rate-limited per IP.
//
// The feature is a single owner switch: corpus.retrieval's `public_search` config. Off (default),
// a codeless visitor's BlockWidget refuses — "open with a code" — exactly as before. On, the widget
// opens a codeless PUBLIC session (published-only scope, which already exists) and runs the tool.
// Published search leaks nothing (published = already anonymous-readable), so the opt-in is a UX
// switch, not a security boundary; the new server-side protection is a per-IP rate limit.
//
// Blackbox: the on/off cases drive the SHIPPED @standmeet/sdk BlockWidget in the browser and assert
// the rendered result. The rate-limit case hits the same code-gated tool endpoint the widget uses,
// from fixed source IPs, and asserts a 429 appears past the cap while a fresh IP still gets through.
//
// Seeds two wiki notes sharing a query term `quokkascope`: one PUBLISHED (needle PUBSEEN), one left
// UNPUBLISHED (needle PRIVSEEN). A codeless public search must surface PUBSEEN and never PRIVSEEN —
// the result text is taken and asserted non-empty + lacking the private needle (not a vacuous
// absence test, [[negated-assertion-passes-while-absent]]).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishPage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pubsearch@example.com', password: 'correct-horse-battery-staple',
  handle: 'pubsearch', fullName: 'Public Search Owner',
};
const SLUG = 'searchpage';
const TERM = 'quokkascope'; // the shared query term both notes carry
const PUBSEEN = 'PUBSEEN'; // needle in the PUBLISHED note — must surface to a codeless search
const PRIVSEEN = 'PRIVSEEN'; // needle in the UNPUBLISHED note — must never surface

// PAGE —— a microsite whose body is the shipped BlockWidget bound to corpus_search. Importing it
// from @standmeet/sdk is the point: this drives the real widget (which decides whether to open a
// codeless public session), not a stand-in.
const PAGE = `
import React from 'react';
import { BlockWidget } from '@standmeet/sdk';
export default function App() {
  return (
    <main className="p-8">
      <BlockWidget tool="corpus_search" args={{ query: '${TERM}' }} runLabel="Search the corpus" />
    </main>
  );
}
`.trim();

// setPublicSearch —— flip corpus.retrieval's public_search config through the same admin API the
// panel uses (block_config.set is generic; no bespoke endpoint). Read fresh into the page's <head>
// on the next load, so a reload after this reflects the new value.
async function setPublicSearch(
  request: APIRequestContext, csrf: string, on: boolean,
): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- seed: flip corpus.retrieval public_search through the generic block_config admin API (the panel's own path; there is no MCP/GUI fixture for block config)
  const res = await request.patch(`${BACKEND}/api/admin/blocks/corpus.retrieval/config`, {
    headers: { 'X-Csrftoken': csrf },
    data: { values: { public_search: on } },
  });
  expect(res.status(), 'set corpus.retrieval public_search').toBe(200);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);

  // Seed two notes that both match TERM; only one is published.
  const apiToken = await createAPIToken(request, csrf, `${OWNER.handle}-seed`);
  const sid = await initMCP(request, apiToken);
  const pub = await seedWiki(request, apiToken, sid, {
    title: `${PUBSEEN} ${TERM} note`,
    body: `${TERM} shared discovery term. ${PUBSEEN} marker inside a PUBLISHED note.`,
    path: 'pubsearch/pubseen',
  });
  await publishEntry(request, apiToken, sid, {
    genre: 'wiki', id: pub.wikiID, excerpt: `${TERM} ${PUBSEEN}`,
  });
  // The private note is created but NEVER published → a codeless public session must not see it.
  await seedWiki(request, apiToken, sid, {
    title: `${PRIVSEEN} ${TERM} note`,
    body: `${TERM} shared discovery term. ${PRIVSEEN} marker inside an UNPUBLISHED note.`,
    path: 'pubsearch/privseen',
  });

  await publishPage(request, csrf, SLUG, PAGE); // create → write → build → promote live
  await request.dispose();
}

// issuePublicSession / callToolRaw —— talk to the code-gated tool endpoint directly, from a chosen
// source IP (X-Forwarded-For; chi.RealIP honours it), so the rate-limit case can bucket by IP.
async function issuePublicSession(
  request: APIRequestContext, ip: string,
): Promise<{ conversationID: string; token: string }> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { 'X-Forwarded-For': ip },
    data: { mode: 'public', visitor_name: 'anon' },
  });
  expect(res.status(), `issue public session from ${ip}`).toBe(200);
  const body = await res.json() as { conversation_id: string; session_token: string };
  return { conversationID: body.conversation_id, token: body.session_token };
}

async function callToolRaw(
  request: APIRequestContext, sess: { conversationID: string; token: string },
  ip: string, tool: string, args: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversationID}/tools/${tool}`,
    { headers: { 'X-Forwarded-For': ip, Authorization: `Bearer ${sess.token}` }, data: args },
  );
  return { status: res.status(), text: await res.text() };
}

test.describe.configure({ timeout: 420_000 });

test.describe('corpus.retrieval · public_search opens codeless published-corpus search', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    await initOwner(playwright);
  });

  test('off → a codeless visitor is told to open with a code, the search does not run',
    async ({ page, playwright }: { page: Page; playwright: Playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await setPublicSearch(request, csrf, false);
      await request.dispose();

      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      // Open the microsite WITHOUT any code — nothing in localStorage to adopt, public_search off.
      await openReader(page, `/p/${SLUG}/`);

      const widget = page.getByTestId('block-widget');
      await expect(widget, 'the widget rendered').toBeVisible({ timeout: 20_000 });
      expect(pageErrors, 'the microsite mounted without throwing').toEqual([]);
      await expect(widget, 'no session and public_search off → no-session shell')
        .toHaveAttribute('data-state', 'no-session');
      await expect(page.getByTestId('block-widget-no-session'),
        'the reader is told to open with a code').toContainText(/access code/i);
      await expect(page.getByTestId('block-widget-run'),
        'no dead run button when the search is not offered').toHaveCount(0);
    });

  test('on → a codeless visitor searches, sees the published note, never the unpublished one',
    async ({ page, playwright }: { page: Page; playwright: Playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await setPublicSearch(request, csrf, true);
      await request.dispose();

      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await openReader(page, `/p/${SLUG}/`);

      const widget = page.getByTestId('block-widget');
      await expect(widget, 'the widget rendered').toBeVisible({ timeout: 20_000 });
      expect(pageErrors, 'the microsite mounted without throwing').toEqual([]);
      // public_search on + a public-safe read tool → the widget offers the run control, not the
      // no-session shell: it will open a codeless public session of its own.
      await expect(widget, 'public_search on → the search is offered to a codeless visitor')
        .toHaveAttribute('data-state', 'ready');

      await page.getByTestId('block-widget-run').click();

      const result = page.getByTestId('block-widget-result');
      await expect(result, 'the codeless search ran server-side and its result rendered')
        .toContainText(PUBSEEN, { timeout: 25_000 });

      // Take the actual result text: non-empty, carries the published needle, lacks the private one.
      const text = (await result.textContent()) ?? '';
      expect(text.trim(), 'the result is not empty').not.toBe('');
      expect(text, 'the published note surfaced to a codeless search').toContain(PUBSEEN);
      expect(text, 'the UNPUBLISHED note never leaks to a codeless (published-only) search')
        .not.toContain(PRIVSEEN);
    });

  test('rate limit → past the per-IP cap the public tool endpoint returns 429; a fresh IP still runs',
    async ({ playwright }: { playwright: Playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await setPublicSearch(request, csrf, true);

      const hammerIP = '198.51.100.7';
      const freshIP = '198.51.100.8';

      // Hammer the public tool endpoint from one IP. The cap is on public-tier tool DISPATCH (checked
      // before block assembly), so a probe tool trips the same guard the search uses and stays cheap.
      const sess = await issuePublicSession(request, hammerIP);
      const codes: number[] = [];
      for (let i = 0; i < 75; i += 1) {
        const { status } = await callToolRaw(request, sess, hammerIP, 'pubsearch_probe', {});
        codes.push(status);
      }
      expect(codes, `no 429 after 75 codeless tool calls from one IP: ${codes.join(',')}`)
        .toContain(429);

      // A fresh IP is unaffected: a real corpus_search from it goes through (200) and still finds
      // the published note — proving the cap is per-IP, not a global kill-switch.
      const fresh = await issuePublicSession(request, freshIP);
      const out = await callToolRaw(request, fresh, freshIP, 'corpus_search', { query: TERM });
      expect(out.status, 'a fresh IP is not rate-limited').toBe(200);
      expect(out.text, 'the fresh-IP search still reaches the published corpus').toContain(PUBSEEN);

      await request.dispose();
    });
});
