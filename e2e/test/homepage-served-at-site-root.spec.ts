// homepage-served-at-site-root.spec.ts —— A Slice 4: the app serves the owner's custom `home` page
// at the SITE ROOT `/` (not just at the backend's /api/v1/homepage), and its bundle actually loads.
//
// homepage-served-at-root.spec.ts already covers the backend endpoint + its `<base href="/">`; what
// that spec can NOT see (it only reads the HTML string) is whether `/` in the real app serves the
// page and whether the `./assets/*` bundle resolves — the gap that left the page blank until this
// slice. This drives the app:
//   • before a `home` page is promoted → `/` is the built-in root page (fall-through preserved);
//   • after promote → `/` serves the home page's marker, AND its JS bundle (`/assets/*`) is 200.
//
// The marker lives ONLY in the promoted home page, so its appearance at `/` proves the middleware
// rewrote the root to the home page — not that the built-in happened to contain it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'siteroot@example.com', password: 'correct-horse-battery-staple',
  handle: 'siteroot', fullName: 'Site Root Owner',
};

const MARKER = 'SLICE4-HOME-ROOT-MARKER';
const HOME_PAGE = `
import React from 'react';
export default function App() {
  return <main data-testid="home-marker" className="p-8">${MARKER}</main>;
}
`.trim();

interface ApiResult { status: number; body: Record<string, unknown> }

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

// promoteHome —— write the marker page onto the reserved `home` slug (already installed at claim),
// build it, and promote it live.
async function promoteHome(request: APIRequestContext, csrf: string): Promise<void> {
  await pagesApi(request, csrf, 'put', '/home/files', { path: 'App.tsx', content: HOME_PAGE });
  const started = await pagesApi(request, csrf, 'post', '/home/build');
  expect(started.status, 'start home build').toBe(200);
  const id = started.body['build_id'] as string;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = (await pagesApi(request, csrf, 'get', `/builds/${id}`)).body;
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  const live = await pagesApi(request, csrf, 'post', '/home/live', { build_id: id });
  expect(live.status, 'promote home to live').toBe(200);
}

// Serial: the "before promote" case must run before the "after promote" case promotes the page.
test.describe.configure({ timeout: 420_000, mode: 'serial' });
test.describe('A Slice 4 · the custom home page is served at the site root', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('before a home page is live, `/` is the built-in page (no home marker)', async ({ page }) => {
    // The claim installs a home DRAFT, not live — so `/` must still be the built-in root page.
    await goto(page, '/');
    await expect(page.getByTestId('home-marker')).toHaveCount(0);
  });

  test('after promote, `/` serves the home page and its bundle loads', async ({ page, request }) => {
    // Log in on THIS test's request context so the CSRF token and its session cookie live
    // together (a token from a disposed context 401s).
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await promoteHome(request, csrf);

    await goto(page, '/');
    // The marker only exists in the promoted home page → its presence proves `/` served it.
    await expect(page.getByTestId('home-marker')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('home-marker')).toContainText(MARKER);

    // The bundle referenced as `./assets/*` (base href /) must resolve at `/assets/*`, else the
    // page would be blank. Assert every loaded /assets/* request returned OK.
    const bundle = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]'))
        .map((s) => (s as HTMLScriptElement).src)
        .find((src) => src.includes('/assets/')) ?? '');
    expect(bundle, 'the home page references an /assets bundle').not.toBe('');
    const res = await request.get(bundle);
    expect(res.status(), 'the /assets bundle must be served at the site root').toBe(200);
  });
});
