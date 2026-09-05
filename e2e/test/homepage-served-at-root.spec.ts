// homepage-served-at-root.spec.ts —— the redesigned homepage is a microsite pinned to `/`.
//
// Slice 2 of homepage-as-microsite: GET /api/v1/homepage serves the reserved `home` page's
// live build at the site root, injecting `<base href="/">` (not `/p/home/`). Two guarantees:
//   1. Before any `home` page is promoted, it 404s — so the app keeps its built-in homepage and
//      nothing breaks the moment this ships (the safety that lets removal come last).
//   2. Once a `home` page is live, `/api/v1/homepage` serves it with a root base href.
// The page's content is irrelevant here (a minimal placeholder) — this tests the SERVE PATH.
//
// Its own patient build-poll (up to 5 min): a loaded local sandbox build settles near the
// shared rig's 180s cap, and this spec only needs the page to go live.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'homeowner@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeowner', fullName: 'Home Owner',
};

const MINIMAL_PAGE = `
import React from 'react';

export default function App() {
  return <main data-testid="mini-home">home</main>;
}
`.trim();

interface ApiResult { status: number; body: Record<string, unknown>; }

async function pagesApi(
  request: APIRequestContext, csrf: string,
  method: 'get' | 'post' | 'put', path: string, data?: unknown,
): Promise<ApiResult> {
  const url = `${BACKEND}/api/admin/microsites${path}`;
  const opts = { headers: { 'X-Csrftoken': csrf }, ...(data === undefined ? {} : { data }) };
  const res = method === 'get'
    ? await request.get(url, opts)
    : method === 'put' ? await request.put(url, opts) : await request.post(url, opts);
  const body = res.ok() ? (await res.json()) as Record<string, unknown> : {};
  return { status: res.status(), body };
}

async function publishPatiently(
  request: APIRequestContext, csrf: string, slug: string, source: string,
): Promise<void> {
  await pagesApi(request, csrf, 'post', '/', { slug, title: slug });
  await pagesApi(request, csrf, 'put', `/${slug}/files`, { path: 'App.tsx', content: source });
  const started = await pagesApi(request, csrf, 'post', `/${slug}/build`);
  expect(started.status, 'start build').toBe(200);
  const id = started.body['build_id'] as string;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = (await pagesApi(request, csrf, 'get', `/builds/${id}`)).body;
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  const live = await pagesApi(request, csrf, 'post', `/${slug}/live`, { build_id: id });
  expect(live.status, 'promote to live').toBe(200);
}

test.describe.configure({ timeout: 420_000 });

test.describe('homepage-as-microsite · served at the root path', () => {
  test.beforeAll(async ({ playwright }) => {
    // The build poll below can run minutes; give the hook itself the budget (describe.configure
    // sets the TEST timeout, not the hook's — a 30s hook default otherwise kills the build wait).
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    // Before any `home` page exists, the root serve 404s → the app keeps its built-in homepage.
    const empty = await request.get(`${BACKEND}/api/v1/homepage`);
    expect(empty.status(), 'no home page yet → 404 (app keeps its built-in homepage)').toBe(404);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPatiently(request, csrf, 'home', MINIMAL_PAGE);
    await request.dispose();
  });

  test('serves the promoted `home` page with a root <base href>', async ({ request }) => {
    const res = await request.get('/api/v1/homepage');
    expect(res.ok(), `homepage should be 200 once live, got ${res.status()}`).toBeTruthy();
    expect(res.headers()['content-type'] ?? '').toContain('text/html');
    const htmlText = await res.text();
    // Root base href — NOT the /p/<slug>/ base a normal microsite gets. This is the one thing
    // that makes it "served at /" rather than under /p/home.
    expect(htmlText, 'served at root → <base href="/">').toContain('<base href="/"');
    expect(htmlText, 'must not carry the /p/home base').not.toContain('/p/home/');
  });
});
