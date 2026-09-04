// custom-page-design-system.spec.ts —— every custom-page build ships the StandMeet design system.
//
// The foundation for homepage-as-custom-page (and any styled page): the builder template now
// pulls in Tailwind v4 + the design tokens + the two brand fonts (builder/template/theme.css), so
// a page can use `text-(--color-accent)` / `font-serif` and get the real palette + type — instead
// of a bare, unstyled Vite build. This publishes a page that uses those classes AND imports the
// SDK, then checks the RENDERED element actually gets the vermillion accent and the serif face —
// i.e. Tailwind processed the tokens and the fonts loaded, not just that the file built.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'themed@example.com', password: 'correct-horse-battery-staple',
  handle: 'themed', fullName: 'Themed Owner',
};
const SLUG = 'themed';

// Uses a design-system class (text-(--color-accent), font-serif) AND imports the SDK client, so
// the build exercises both the Tailwind pipeline and the vendored @standmeet/sdk-core.
const THEMED_PAGE = `
import React from 'react';
import { createClient } from '@standmeet/sdk-core';

const sm = createClient({ baseURL: '' });

export default function App() {
  void sm.fetchCorpusCards; // reference the new SDK method so the vendored client must carry it
  return (
    <p data-testid="themed-line" className="font-serif text-(--color-accent) text-[24px]">
      themed
    </p>
  );
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

test.describe('a custom page is built with the StandMeet design system', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPatiently(request, csrf, SLUG, THEMED_PAGE);
    await request.dispose();
  });

  test('design-system classes render with the real accent color and serif face', async ({ page }) => {
    await goto(page, `/p/${SLUG}/`);
    const line = page.getByTestId('themed-line');
    await expect(line).toBeVisible();

    const color = await line.evaluate((el) => getComputedStyle(el).color);
    // --color-accent light = #B5391C = rgb(181, 57, 28). If Tailwind didn't process the tokens,
    // text-(--color-accent) resolves to nothing and the color stays the default ink.
    expect(color, 'text-(--color-accent) must resolve to the vermillion token').toBe('rgb(181, 57, 28)');

    const font = await line.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase(), 'font-serif must map to the Newsreader token').toContain('newsreader');
  });
});
