// microsite-prerendered-for-ai.spec.ts —— a microsite must be readable by a client that runs no
// JavaScript (a crawler, an AI reader, a link-preview bot). The build ships a **prerendered** copy
// of the page inside the served HTML, so the owner's prose is in the initial bytes — not an empty
// `<div id="root"></div>` that only fills in after React boots.
//
// Faithful blackbox: we fetch /p/<slug> with a plain APIRequestContext (no browser, no JS) — the
// exact bytes an AI reader sees — and assert the owner's heading + paragraph text are present, and
// that a <title> was derived from the page. Then we open it in a real browser and assert the same
// heading is visible with no page error, proving hydration mounts onto the prerendered DOM rather
// than blowing it away or throwing.
//
// RED on the old builder: it runs `vite build` only, so /p/<slug> is `<div id="root"></div>` with
// the prose reachable solely by running the bundle — the raw-HTML assertions fail. GREEN once the
// builder prerenders the App into index.html at build time.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'prerender@example.com', password: 'correct-horse-battery-staple',
  handle: 'prerender', fullName: 'Prerender Owner',
};
const SLUG = 'readable';
const TITLE_MARKER = 'PRERENDER_HEADING_MARKER';
const BODY_MARKER = 'PRERENDER_BODY_PROSE_a1b2c3';
// A widget that fetches at runtime (useEffect) must not break the server render: the prose around it
// still has to prerender. CorpusWidget is the real thing owners drop in; here we just prove a plain
// App prerenders. (Widget SSR-safety is covered by the SDK's own try/catch guards.)
const OWNER_APP = `
export default function App() {
  return (
    <main data-testid="microsite">
      <h1>${TITLE_MARKER}</h1>
      <p>${BODY_MARKER} — an AI reader must see this without running any JavaScript.</p>
    </main>
  );
}
`.trim();

interface BuildPayload { build_id: string; page_id: string; status: string; error_message?: string }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('microsite · prerendered so a no-JS AI reader gets the content', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the served HTML carries the prose + a derived title before any JS runs, and hydrates cleanly',
    async ({ playwright, adminPage: page }) => {
      test.setTimeout(300_000); // one real vite build + prerender, queued behind sibling builds.
      const request = await playwright.request.newContext();
      await publishMicrosite(request, SLUG, OWNER_APP);

      // 1. What a no-JS AI reader sees: the raw served bytes.
      const raw = await (await request.get(`/p/${SLUG}`)).text();
      expect(raw, 'the prose is in the initial HTML, not only after JS boots').toContain(BODY_MARKER);
      expect(raw, 'the heading text is in the initial HTML').toContain(TITLE_MARKER);
      expect(raw, 'the root is prerendered, not an empty shell')
        .not.toContain('<div id="root"></div>');
      expect(raw, 'a <title> was derived from the page content')
        .toMatch(new RegExp(`<title>[^<]*${TITLE_MARKER}[^<]*</title>`));
      await request.dispose();

      // 2. Hydration: the real browser mounts onto the prerendered DOM without throwing or blanking.
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openReader(page, `/p/${SLUG}`);
      await expect(page.getByRole('heading', { name: TITLE_MARKER })).toBeVisible({ timeout: 20_000 });
      expect(errors, 'hydration produced no page error').toEqual([]);
    });
});

// publishMicrosite —— MCP create → write App → build → promote_to_live, then wait until /p/<slug>
// actually serves 200 (built is one step before live).
async function publishMicrosite(request: APIRequestContext, slug: string, source: string): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'prerender-test');
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'microsite.create', { slug, title: slug });
  const written = await callTool<BuildPayload>(request, token, sid, 'microsite.write_file',
    { slug, path: 'App.tsx', content: source });
  const built = await waitForBuild(request, token, sid, written.build_id);
  await callTool(request, token, sid, 'microsite.promote_to_live', { slug, build_id: built.build_id });
  await expect
    .poll(async () => (await request.get(`/p/${slug}`)).status(),
      { message: `/p/${slug} is serving`, timeout: 30_000 })
    .toBe(200);
}

async function waitForBuild(
  request: APIRequestContext, token: string, sid: string, buildID: string,
): Promise<BuildPayload> {
  let last: BuildPayload = { build_id: buildID, page_id: '', status: 'pending' };
  await expect.poll(async () => {
    last = await callTool<BuildPayload>(request, token, sid, 'microsite.get_build', { build_id: buildID });
    if (last.status === 'failed') throw new Error(`build failed: ${last.error_message ?? '(no message)'}`);
    return last.status;
  }, { timeout: 180_000, intervals: [1000, 1000, 2000] }).toBe('built');
  return last;
}
