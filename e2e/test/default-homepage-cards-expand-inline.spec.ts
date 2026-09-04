// default-homepage-cards-expand-inline.spec.ts —— I (owner-reported): the default homepage's
// corpus cards must open **in place**, not redirect away ("clicking straight into it is just a redirect, that's terrible").
//
// This builds the REAL pre-installed default homepage (the embedded template that claim installs
// as the reserved `home` page — no file is overwritten here, so the template itself is under
// test), publishes it, and drives it in a browser:
//   1. a published corpus entry shows up as a card (title + excerpt);
//   2. clicking the card reveals the note's body inline (pulled with the SDK's keyless
//      fetchWikiLanding) — and the page does NOT navigate away.
//
// If the homepage regressed to a hard <a href="/wiki/…"> redirect, step 2's assertion that the
// body appears while the URL stays on /api/v1/homepage would fail.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'homeinline@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeinline', fullName: 'Home Inline Owner',
};

const NOTE_TITLE = 'The Deterministic State Holder';
// A distinctive sentence that lives ONLY in the note body — never in the card excerpt — so seeing
// it on screen proves the body was pulled inline, not that the excerpt was already showing.
const NOTE_BODY = 'Keeping every fact in exactly one place is the whole discipline here inline-proof.';

interface ApiResult { status: number; body: Record<string, unknown> }

async function pagesApi(
  request: APIRequestContext, csrf: string,
  method: 'get' | 'post', path: string, data?: unknown,
): Promise<ApiResult> {
  const url = `${BACKEND}/api/admin/custom-pages${path}`;
  const opts = { headers: { 'X-Csrftoken': csrf }, ...(data === undefined ? {} : { data }) };
  const res = method === 'get' ? await request.get(url, opts) : await request.post(url, opts);
  const body = res.ok() ? (await res.json()) as Record<string, unknown> : {};
  return { status: res.status(), body };
}

// buildInstalledHome —— build + promote the `home` page that claim already installed. No file is
// written: the point is to exercise the embedded default template exactly as shipped.
async function buildInstalledHome(request: APIRequestContext, csrf: string): Promise<void> {
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

test.describe.configure({ timeout: 420_000 });

// A Slice 4 landed the root-serving cutover (`/` → the live home page + `/assets/*` proxy), so this
// now drives the REAL homepage at the site root `/`, exactly as a visitor to the owner's domain
// sees it — the default template (which composes the SDK widgets) + inline card expansion.
test.describe('the default homepage opens corpus cards inline (no redirect)', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'homeinline-seed');
    const sid = await initMCP(request, token);
    const note = await seedWiki(request, token, sid, { title: NOTE_TITLE, body: NOTE_BODY });
    await publishEntry(request, token, sid, {
      genre: 'wiki', id: note.wikiID, excerpt: 'a curated card excerpt',
    });
    await buildInstalledHome(request, csrf);
    await request.dispose();
  });

  test('a card shows the note, and clicking it reveals the body inline without navigating',
    async ({ page }) => {
      await goto(page, '/'); // the site root — the homepage as a visitor to the domain sees it

      // The card is there (title from fetchCorpusCards, via CorpusWidget).
      const title = page.getByText(NOTE_TITLE, { exact: false });
      await expect(title.first()).toBeVisible({ timeout: 20_000 });

      // The body sentence is NOT on screen yet (only the excerpt is).
      await expect(page.getByText(NOTE_BODY, { exact: false })).toHaveCount(0);

      // Open the card in place.
      await title.first().click();

      // The body was pulled inline (fetchWikiLanding) — and we never left the homepage.
      await expect(page.getByText(NOTE_BODY, { exact: false }).first())
        .toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname,
        'opening a card must not navigate away from the homepage root').toBe('/');
    });
});
