// custom-pages-linked-on-public-surfaces.spec.ts —— a published custom page is discoverable.
//
// Before this, an owner's custom pages were reachable only by knowing the /p/<slug> URL:
// the public index, the gate, and the readers carried no link to them, and there was no
// endpoint to even list them. This guards the fix — GET /api/v1/custom-pages plus links on
// the index (a "pages" deck), the shared footer, and the gate (the codeless-read panel).
// Publish one live page, then assert those surfaces link it.
//
// It publishes with its own patient build-poll instead of the shared rig's publishPage: the
// rig caps the wait at 180s, and on a heavily loaded local runner the sandbox build settles
// right at that edge (it succeeds — the poll just races it). This spec only needs the page
// to go live, so it waits as long as the build needs.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};
const SLUG = 'welcome';

// A minimal page (no @standmeet/sdk import) builds fastest — this spec only needs one live
// page to exist, not a working chat, so it doesn't pay for bundling the SDK.
const MINIMAL_PAGE = `
import React from 'react';

export default function App() {
  return <main data-testid="mini-page">welcome</main>;
}
`.trim();

interface ApiResult { status: number; body: Record<string, unknown>; }

async function pagesApi(
  request: APIRequestContext, csrf: string,
  method: 'get' | 'post' | 'put', path: string, data?: unknown,
): Promise<ApiResult> {
  const url = `${BACKEND}/api/admin/custom-pages${path}`;
  const opts = { headers: { 'X-Csrftoken': csrf }, ...(data === undefined ? {} : { data }) };
  const res = method === 'get'
    ? await request.get(url, opts)
    : method === 'put' ? await request.put(url, opts) : await request.post(url, opts);
  const body = res.ok() ? (await res.json()) as Record<string, unknown> : {};
  return { status: res.status(), body };
}

// publishPatiently —— create → write → build → wait for the build (up to 5 min, since a
// loaded local sandbox can be slow) → promote to live.
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

test.describe('a published custom page is discoverable on the public surfaces', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPatiently(request, csrf, SLUG, MINIMAL_PAGE);
    await request.dispose();
  });

  test('the index links the live page via its page-nav widget', async ({ page }) => {
    // The index is the custom `home` page now; wait for it to auto-go-live, then its PageNavWidget
    // lists the other published pages (the old built-in "pages deck" / homepage footer are gone —
    // discovery on the index is the widget; discovery on the gate is the panel below).
    await expect.poll(
      async () => (await page.request.get('/api/v1/homepage')).status(),
      { timeout: 60_000, message: 'the default homepage auto-goes-live' },
    ).toBe(200);
    await goto(page, '/');
    const nav = page.getByTestId('page-nav-widget');
    await expect(nav, 'the homepage lists other pages once one is live').toBeVisible();
    await expect(nav.getByTestId(`page-nav-widget-link-${SLUG}`))
      .toHaveAttribute('href', `/p/${SLUG}/`);
  });

  test('the gate read panel links the page for a codeless visitor', async ({ page }) => {
    await goto(page, '/gate');
    const panel = page.getByTestId('gate-custom-pages');
    await expect(panel, 'the gate surfaces published pages to a no-code visitor').toBeVisible();
    await expect(panel.getByRole('link', { name: SLUG })).toHaveAttribute('href', `/p/${SLUG}`);
  });
});
