// custom-page-admin-authoring.spec.ts —— custom page authoring also works
// through the **panel**, and it says something when it fails.
//
// Why this file exists: writing this group once ran only through MCP, and the
// exception's stated reason was `fp.Only("…the panel has no such surface",
// "mcp")` — explaining the status quo with the status quo, written where the
// ratchet can read it, so the gap stopped being reported from then on. After
// removing the exception, the collection names these eight cases at startup.
//
// **The point of this file is the failure path.** Existing coverage was three
// cases, all happy path: build-then-visible, no dead buttons,
// staging→live→delete. Not one of the nine ops had a failure case
// ([[all-tests-are-failure-path]]'s mirror image). And to the owner, "the
// build silently failed, the old page is still live" looks exactly the same
// on screen as "the build succeeded."

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'page-authoring@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'authoring',
  fullName: 'Page Authoring Owner',
};

const MARKER = 'ADMIN_AUTHORED_PAGE';

// GOOD —— a minimal page that compiles.
const GOOD_APP = `
export default function App() {
  return <main><h1>${MARKER}</h1></main>;
}
`.trim();

// BAD —— **does not compile**. Missing a closing brace; vite will always fail.
// The criterion wants "the owner is told where it broke," so the break lives
// in the source, not in the request parameters.
const BAD_APP = `
export default function App() {
  return <main><h1>never built</h1></main>;
`.trim();

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

interface BuildRow { build_id?: string; status?: string; error_message?: string }

// api —— the panel path (admin HTTP), **not MCP**. This whole file goes through it only.
async function api(
  request: APIRequestContext, csrf: string, method: 'get' | 'post' | 'put' | 'delete',
  path: string, data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request[method](`${BACKEND}/api/admin/custom-pages${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status(), body };
}

// buildUntilSettled —— polls until built | failed. The build is async (the
// sandbox spins up vite), so the criterion has to wait for a terminal state;
// otherwise it's asserting "still pending," which holds for any implementation.
async function buildUntilSettled(
  request: APIRequestContext, csrf: string, slug: string,
): Promise<BuildRow> {
  const started = await api(request, csrf, 'post', `/${slug}/build`);
  expect(started.status, 'the panel can start a build').toBe(200);
  const id = started.body['build_id'] as string;
  expect(id, 'and it hands back the build id to poll').toBeTruthy();
  let row: BuildRow = {};
  await expect.poll(async () => {
    const got = await api(request, csrf, 'get', `/builds/${id}`);
    row = got.body;
    return row.status ?? 'pending';
    // 180s isn't "wait longer and hope": the sandbox **builds one at a time**, and several
    // cases in this group each need a real build, so they queue on the same builder. Run
    // this case alone and it settles in 9.5s; run the whole group together and it queues
    // behind the others. The budget is for **queueing**, not for a build that might never come.
  }, { timeout: 180_000, message: 'the build never reached a terminal state' })
    .toMatch(/^(built|failed)$/);
  return row;
}

// liveAt —— build a page and promote it live, return the visitor-side response. The shared
// precondition for withdrawal cases: "it really was serving before withdrawal" must be
// actually asserted, otherwise a 404 after withdrawal might have been a 404 all along.
async function liveAt(
  request: APIRequestContext, csrf: string, slug: string,
) {
  await api(request, csrf, 'post', '/', { slug, title: slug });
  await api(request, csrf, 'put', `/${slug}/files`, { path: 'App.tsx', content: GOOD_APP });
  const built = await buildUntilSettled(request, csrf, slug);
  expect(built.status, built.error_message ?? '').toBe('built');
  await api(request, csrf, 'post', `/${slug}/live`, { build_id: built.build_id });
  return request.get(`${BACKEND}/api/v1/custom-pages/${slug}`);
}

// freshOwner —— one clean instance + a logged-in admin request context per case. Shared by
// both describes. Every case has to build a page for real (the sandbox spins up vite,
// **one build at a time**). The default 30s case budget would **cut the 180s poll above off
// mid-flight** — so a timeout would read as "the build is stuck," when the real cause is
// queueing ([[red-in-the-wrong-place]]). What gets widened here is the queueing budget; the
// poll itself still has its own endpoint, and a build that truly can't finish still goes red.
const BUILD_BUDGET_MS = 240_000;

async function freshOwner(playwright: Playwright): Promise<{
  request: APIRequestContext; csrf: string;
}> {
  test.setTimeout(BUILD_BUDGET_MS);
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

test.describe('custom pages · authoring from the panel (parity with MCP)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await freshOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('the whole lifecycle runs on the panel, and the visitor gets the page', async () => {
    expect((await api(request, csrf, 'post', '/', { slug: 'from-panel', title: 'From Panel' }))
      .status, 'create').toBe(201);
    expect((await api(request, csrf, 'put', '/from-panel/files',
      { path: 'App.tsx', content: GOOD_APP })).status, 'write_file').toBe(200);

    const built = await buildUntilSettled(request, csrf, 'from-panel');
    expect(built.status, built.error_message ?? '').toBe('built');

    expect((await api(request, csrf, 'post', '/from-panel/live',
      { build_id: built.build_id })).status, 'promote_to_live').toBe(200);

    // The visitor side is the criterion — the panel saying "success" doesn't count.
    const seen = await request.get(`${BACKEND}/api/v1/custom-pages/from-panel`);
    expect(seen.status()).toBe(200);
    expect(await seen.text()).toContain('<div id="root">');
  });

  test('a build that cannot compile fails loudly and leaves the live page alone', async () => {
    // Ship a working version first, so we can prove "a failure doesn't touch what's live."
    await api(request, csrf, 'post', '/', { slug: 'broken', title: 'Broken' });
    await api(request, csrf, 'put', '/broken/files', { path: 'App.tsx', content: GOOD_APP });
    const good = await buildUntilSettled(request, csrf, 'broken');
    expect(good.status).toBe('built');
    await api(request, csrf, 'post', '/broken/live', { build_id: good.build_id });

    // Now push a version that fails to compile.
    await api(request, csrf, 'put', '/broken/files', { path: 'App.tsx', content: BAD_APP });
    const bad = await buildUntilSettled(request, csrf, 'broken');

    expect(bad.status, 'a build that cannot compile must not report built').toBe('failed');
    // **Don't just assert "has an error_message"** — an empty string also "has" one. Assert
    // it actually says something, otherwise the owner gets a failure with no cause
    // ([[collapsed-error-class-kills-its-own-branch]]). What's asserted is **that it names
    // which source file broke**, not merely "it said something."
    //
    // An earlier version asserted `length > 10` — any message long enough would pass, and
    // what the product actually returned at the time was exactly
    // `Command failed: node /tmp/work/<uuid>/node_modules/vite/bin/vite.js build --logLevel error`:
    // long enough, and entirely our own internal command line — not one character of what the
    // owner needed to change (F-P-3). Length isn't the criterion; length is just a shape
    // that's vacuously true ([[assertion-that-cannot-fail]]).
    expect(bad.error_message ?? '',
      'the failure must name the source that broke, not our own command line')
      .toContain('App.tsx');
    // And it must not dump esbuild's own call stack alongside it. That's exactly what the
    // first version did once stderr was captured: "which line broke" was correct, but
    // followed by a whole stack of `at failureErrorWithLog (node_modules/esbuild/…)`,
    // pushing the two useful lines out of view — fixing one problem created another
    // (the second half of F-P-3).
    expect(bad.error_message ?? '', 'and it must not dump a stack trace at the owner')
      .not.toMatch(/\bat \w+ \(/);

    // What's live is still the previous version: a failure must not take down what's already serving.
    const still = await request.get(`${BACKEND}/api/v1/custom-pages/broken`);
    expect(still.status(), 'a failed build must not take the live page down').toBe(200);
  });

  test('a build that is not built cannot be promoted', async () => {
    await api(request, csrf, 'post', '/', { slug: 'unbuilt', title: 'Unbuilt' });
    await api(request, csrf, 'put', '/unbuilt/files', { path: 'App.tsx', content: BAD_APP });
    const failed = await buildUntilSettled(request, csrf, 'unbuilt');
    expect(failed.status).toBe('failed');

    const promoted = await api(request, csrf, 'post', '/unbuilt/live',
      { build_id: failed.build_id });
    expect(promoted.status, 'promoting a failed build must be refused').toBeGreaterThanOrEqual(400);
    const gone = await request.get(`${BACKEND}/api/v1/custom-pages/unbuilt`);
    expect(gone.status(), 'and nothing becomes reachable').toBeGreaterThanOrEqual(400);
  });

  test('a slug that already exists is refused', async () => {
    expect((await api(request, csrf, 'post', '/', { slug: 'twice', title: 'One' })).status).toBe(201);
    const again = await api(request, csrf, 'post', '/', { slug: 'twice', title: 'Two' });
    expect(again.status, 'the second create on the same slug is refused')
      .toBeGreaterThanOrEqual(400);
  });
});

// I-3: withdrawal means withdrawal. The three cases below each withdraw a different way; the
// criterion is always on the **visitor side**.
// A separate describe — the block above already hit the 70-line gate.
test.describe('custom pages · withdrawal is not a snapshot (I-3)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await freshOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('rollback takes the page down for the visitor', async () => {
    const live = await liveAt(request, csrf, 'rolled');
    expect(live.status(), 'it is serving before the rollback').toBe(200);

    expect((await api(request, csrf, 'post', '/rolled/rollback')).status).toBe(200);

    const after = await request.get(`${BACKEND}/api/v1/custom-pages/rolled`);
    expect(after.status(), 'after a rollback the visitor URL stops serving')
      .toBeGreaterThanOrEqual(400);
  });

  test('deleting a live page takes it down for the visitor', async () => {
    expect((await liveAt(request, csrf, 'deleted')).status()).toBe(200);
    expect((await api(request, csrf, 'delete', '/deleted')).status).toBe(200);

    const after = await request.get(`${BACKEND}/api/v1/custom-pages/deleted`);
    expect(after.status(), 'a deleted page stops serving').toBeGreaterThanOrEqual(400);
  });

  // The hosted page's freedom **is something that can be taken away all at once by a single
  // header line**.
  //
  // Pages can embed remote images / mp4 / audio / third-party iframes / remote fonts because
  // this path has no CSP and no X-Frame-Options. The day someone adds a "security hardening"
  // default header on app or backend, **every page an owner built goes dumb at once**, with
  // no error: images don't show, video doesn't play, iframes go blank. This case guards
  // exactly that — it asserts "we didn't tell the browser to refuse," not whether any
  // particular piece of media can load (that would mean reaching out to the public internet,
  // tying the whole e2e suite to someone else's uptime).
  test('nothing on this path tells the browser to refuse third-party media', async () => {
    const live = await liveAt(request, csrf, 'openpage');
    expect(live.status()).toBe(200);
    const h = live.headers();
    expect(h['content-security-policy'] ?? '',
      'a CSP here would silently kill remote img/video/audio on every custom page').toBe('');
    expect(h['content-security-policy-report-only'] ?? '').toBe('');
    // A third-party iframe is **this page embedding someone else**, the opposite direction
    // from X-Frame-Options (someone else embedding this page), so this only asserts that
    // we're not blocking our own page with CSP's frame-src — the case above already covers that.
    expect(h['cross-origin-embedder-policy'] ?? '',
      'COEP would break every cross-origin image and media on the page').toBe('');
  });

  test('the page is never handed to the browser as cacheable', async () => {
    const live = await liveAt(request, csrf, 'nocache');
    // If it's still openable after withdrawal because we told the browser to cache it, that's
    // our problem, not the browser's. This path used to **send no Cache-Control header at
    // all** — no header, so the browser caches on its own heuristics.
    expect(live.headers()['cache-control'] ?? '',
      'a withdrawable page must not be advertised as cacheable').toMatch(/no-store|no-cache/);
  });
});
