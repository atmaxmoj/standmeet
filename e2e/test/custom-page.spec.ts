// custom-page.spec.ts -- the owner writes a custom React page via MCP, and a visitor sees
// the vite-built page at /<handle>/p/<slug>.
//
// User story:
//   alice tells her own AI client "build me a /showcase page". The AI goes through MCP:
//   custom_page.create('showcase') -> write_file('App.tsx', ...) -> build ->
//   poll get_build -> promote_to_live. A visitor opening /alice/p/showcase then sees the
//   content from the vite-built React page; rollback falls back to the default (404 no
//   live).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto, gotoAdminSection, reloadAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SLUG = 'showcase';
const PAGE_TITLE = 'Alice thinks out loud';
const HELLO_MARKER = 'STANDMEET_CUSTOM_PAGE_HELLO';
const OWNER_APP = `
import React from 'react';

export default function App() {
  return (
    <main data-testid="custom-page">
      <h1>${PAGE_TITLE}</h1>
      <p>${HELLO_MARKER}</p>
    </main>
  );
}
`.trim();

interface BuildPayload {
  build_id: string;
  page_id: string;
  status: string;
  output_path?: string;
  error_message?: string;
}

interface PagePayload {
  id: string;
  slug: string;
  title: string;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner publishes custom React page; visitor lands on it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('MCP create + write_file + build + promote_to_live → visitor sees React content',
    async ({ playwright, adminPage: page }) => {
      const request = await playwright.request.newContext();
      const { token, sid } = await mcpSetup(request);
      await ownerPublishesCustomPage(request, token, sid);
      await visitorSeesPublishedContent(page);
      await ownerRollsBackToDefault(request, token, sid);
      await visitorSeesNotFoundAfterRollback(page);
      await request.dispose();
    });

  // F-N-1: the section header must NOT present a dead "+ new page" button. Page creation is
  // MCP-driven (custom_page.create/.build/.promote_to_live) — the button had no onClick and did
  // nothing on click. Guard: the affordance is absent and the MCP direction is what's shown.
  // F-N-1 used to assert "there is no dead '+ new page' entry point" -- back then the
  // panel genuinely couldn't create a page, so putting a button there would be lying.
  // **Now it can** (writing a page is no longer MCP-only), so the same rule gets asserted
  // differently: the entry point must exist, and **must actually be connected to
  // something**.
  //
  // "the button must not exist" and "the button must exist and work" are the same rule
  // seen in two different worlds; keeping the old assertion around would turn it into a
  // blocker against the correct product once the capability was added.
  test('the authoring affordance exists and is wired (F-N-1, in the world where it works)',
    async ({ adminPage: page }) => {
      // The editor lives at its own route now (/admin/edit/<slug>); /admin/edit/new starts a
      // fresh page with an editable slug.
      await goto(page, '/admin/edit/new');
      await expect(page.getByTestId('custom-page-source')).toBeVisible();
      await expect(page.getByTestId('custom-page-publish')).toBeVisible();
      // Disabled with an empty slug -- that isn't "a dead button", that's it being able
      // to state what it can't do right now.
      await expect(page.getByTestId('custom-page-publish')).toBeDisabled();
      await page.getByTestId('custom-page-slug').fill('from-the-panel');
      await expect(page.getByTestId('custom-page-publish')).toBeEnabled();
    });

  // The redesign: /admin/custom-pages is JUST the list; it marks the reserved `home` page, and
  // clicking a page navigates to that page's OWN editor route (/admin/edit/<slug>) — a mini-IDE
  // with the page's files — instead of the old "every page rendered inline + one editor at the
  // bottom".
  test('the list marks the homepage, and opening a page navigates to its own editor',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'custom-pages');
      await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
      await expect(
        page.getByTestId('custom-page-homepage-badge'), 'the home page is marked in the list',
      ).toBeVisible();
      // The row links into the page's own editor route (the redesign: /admin/custom-pages is just
      // the list; opening a page goes to /admin/edit/<slug>). Assert the wiring on the anchor,
      // then that the route is the editor with the page's files — this decouples the check from
      // the client-side nav's timing, which flakes when the list is re-rendering under build load.
      const opener = page.getByTestId('custom-page-open-home');
      await expect(opener.locator('xpath=ancestor::a'), 'the row opens the page editor')
        .toHaveAttribute('href', /\/admin\/edit\/home$/);
      await goto(page, '/admin/edit/home');
      await expect(
        page.getByTestId('custom-page-file-App.tsx'),
        'the page opens in its own editor with its files loaded',
      ).toBeVisible();
    });

  // F-P-2 -- **editing a version and republishing** is the most common thing done on
  // this screen, not an edge case.
  //
  // The previous version hardcoded "create" as the first step of the publish sequence, so
  // publishing the same slug a second time hit a 409 and the whole sequence stalled right
  // there: the source never got written, the build never ran, production stayed on the
  // old version. The owner has exactly one button, and that button **never works** on a
  // page that already exists.
  //
  // Asserts that **the second version genuinely went live**, not "no error was thrown":
  // whether an error was reported and whether the page actually changed are two different
  // things.
  test('publishing the same slug again ships the new source (F-P-2)',
    async ({ adminPage: page }) => {
      // Two real builds, and the sandbox builds only one at a time -- the default 30s
      // test budget would run out mid-poll during the first build, and that red would
      // read as "the second publish never went out", when it's actually the queue
      // getting cut off ([[red-in-the-wrong-place]]).
      test.setTimeout(300_000);
      await publishFromPanel(page, 'twice-over', markerApp('FIRST_CUT'));
      await expectServed(page, 'twice-over', 'FIRST_CUT');

      await publishFromPanel(page, 'twice-over', markerApp('SECOND_CUT'));
      await expectServed(page, 'twice-over', 'SECOND_CUT');
    });

  // F-P-4 -- **if you can publish it, you must be able to take it back down**.
  //
  // "the owner takes it down in admin, and the visitor can no longer reach it" is one of
  // this family's rules, and the previous version of this screen only had one action,
  // "view live": taking a page down was MCP-only, so to pull down something they'd just
  // published, the owner had to open a separate Claude session. The criterion sits **on
  // the visitor's side** -- the panel saying it's down doesn't count on its own.
  test('the panel can take a page down again, and the visitor loses it (F-P-4)',
    async ({ adminPage: page }) => {
      test.setTimeout(300_000);
      await publishFromPanel(page, 'withdrawn', markerApp('STILL_UP'));
      await expectServed(page, 'withdrawn', 'STILL_UP');

      await reloadAdminSection(page, 'custom-pages');
      await page.getByTestId('custom-page-takedown-withdrawn').click();

      await expect.poll(async () => {
        const after = await page.request.get('/api/v1/custom-pages/withdrawn');
        return after.status();
      }, { message: 'a page taken down in the panel stops serving' }).toBeGreaterThanOrEqual(400);
    });

  // The mini-IDE's defining capability — multi-file build (see helper for the why).
  test('a page spans multiple source files — add one, App imports it, the build renders both',
    ({ adminPage: page }) => multiFileBuildSpansBoth(page));

  // Regression guard: the list "view live" link is a real navigation (see helper).
  test('the list "view live" link navigates to the served page (regression: dead next/link)',
    ({ adminPage: page }) => viewLiveLinkNavigates(page));
});

// multiFileBuildSpansBoth — extracted so the describe block stays under the per-function line cap.
async function multiFileBuildSpansBoth(page: Page): Promise<void> {
  test.setTimeout(300_000);
  await goto(page, '/admin/edit/new');
  await page.getByTestId('custom-page-slug').fill('multi-file');
  // App imports a second file that doesn't exist yet.
  await fillSource(page, [
    "import Helper from './Helper';",
    'export default function App() {',
    '  return <main><Helper /></main>;',
    '}',
  ].join('\n'));
  // Add the second file via the inline field (not a window.prompt), then fill it. It becomes the
  // active tab, so the editor now shows Helper.tsx.
  await page.getByTestId('custom-page-add-file').click();
  await page.getByTestId('custom-page-add-file-input').fill('Helper.tsx');
  await page.getByTestId('custom-page-add-file-input').press('Enter');
  await expect(page.getByTestId('custom-page-file-Helper.tsx')).toBeVisible();
  await fillSource(page,
    'export default function Helper() {\n  return <h1>MULTI_FILE_MARKER</h1>;\n}');
  await page.getByTestId('custom-page-publish').click();
  await expect(page.getByTestId('custom-page-build-status'))
    .toHaveText(/built/i, { timeout: 180_000 });
  // The marker lives ONLY in the imported second file — seeing it proves the build spanned both.
  await goto(page, '/p/multi-file');
  await expect(page.getByRole('heading', { name: 'MULTI_FILE_MARKER' }))
    .toBeVisible({ timeout: 20_000 });
}

// viewLiveLinkNavigates — extracted for the same line-cap reason.
async function viewLiveLinkNavigates(page: Page): Promise<void> {
  test.setTimeout(300_000);
  await publishFromPanel(page, 'view-live-nav', markerApp('VIEW_LIVE_NAV'));
  await reloadAdminSection(page, 'custom-pages');
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  await page.locator('[data-testid="custom-page-row-view-live-nav"]')
    .getByRole('link', { name: 'view live ↗' }).click();
  await page.waitForURL('**/p/view-live-nav', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'VIEW_LIVE_NAV' }))
    .toBeVisible({ timeout: 20_000 });
}

function markerApp(marker: string): string {
  return `export default function App() {\n  return <main><h1>${marker}</h1></main>;\n}`;
}

// publishFromPanel -- fills in the slug, pastes the source, clicks publish, and waits for
// the build to reach a terminal state. **Only waits for a terminal state**: asserting on
// "still running" would hold for any implementation.
async function publishFromPanel(page: Page, slug: string, source: string): Promise<void> {
  // Does a **full page navigation** to the editor route every time -- after the previous
  // run viewed the live page, the browser is sitting on `/p/<slug>`, which has no
  // sidebar. /admin/edit/new starts a fresh page with an editable slug, so re-publishing
  // the same slug just types it again (ensurePage tolerates the existing page).
  await goto(page, '/admin/edit/new');
  await page.waitForURL('**/admin/edit/new', { timeout: 10_000 });
  await page.getByTestId('custom-page-slug').fill(slug);
  await fillSource(page, source);
  await page.getByTestId('custom-page-publish').click();
  // The sandbox builds one at a time, and other tests in this family are also building --
  // the timeout budget accounts for queueing.
  await expect(page.getByTestId('custom-page-build-status'))
    .toHaveText(/built/i, { timeout: 180_000 });
}

// fillSource -- set the active file's source in the CodeMirror editor. The testid sits on the
// editor's wrapper; the editable surface is `.cm-content` (contenteditable). fill() pastes the
// text in one shot, so CodeMirror's bracket-closing doesn't fire per keystroke and corrupt JSX.
async function fillSource(page: Page, source: string): Promise<void> {
  const body = page.getByTestId('custom-page-source').locator('.cm-content');
  await body.click();
  await body.fill(source);
}

async function expectServed(page: Page, slug: string, marker: string): Promise<void> {
  const served = await page.request.get(`/api/v1/custom-pages/${slug}`);
  expect(served.status(), `/p/${slug} is serving`).toBe(200);
  const assets = await page.request.get(`/p/${slug}`);
  expect(await assets.text(), `the live page carries ${marker}`).toContain('<div id="root">');
  await goto(page, `/p/${slug}`);
  await expect(page.getByRole('heading', { name: marker })).toBeVisible({ timeout: 20_000 });
}

async function mcpSetup(
  request: APIRequestContext,
): Promise<{ token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'custom-page-test');
  const sid = await initMCP(request, token);
  return { token, sid };
}

async function ownerPublishesCustomPage(
  request: APIRequestContext, token: string, sid: string,
): Promise<BuildPayload> {
  await callTool<PagePayload>(request, token, sid, 'custom_page.create', {
    slug: SLUG, title: PAGE_TITLE,
  });
  const writeResult = await callTool<BuildPayload>(
    request, token, sid, 'custom_page.write_file',
    { slug: SLUG, path: 'App.tsx', content: OWNER_APP },
  );
  const built = await waitForBuild(request, token, sid, writeResult.build_id);
  expect(built.status).toBe('built');
  await callTool<PagePayload>(request, token, sid, 'custom_page.promote_to_live', {
    slug: SLUG, build_id: built.build_id,
  });
  return built;
}

async function waitForBuild(
  request: APIRequestContext, token: string, sid: string, buildID: string,
): Promise<BuildPayload> {
  // expect.poll is playwright's built-in "retry until predicate true" -- more observable
  // than a hand-rolled setTimeout loop, and it respects spec.timeout, satisfying the
  // eslint no-sleep rule.
  let last: BuildPayload = { build_id: buildID, page_id: '', status: 'pending' };
  await expect.poll(
    async () => {
      last = await callTool<BuildPayload>(request, token, sid, 'custom_page.get_build', {
        build_id: buildID,
      });
      if (last.status === 'failed') {
        throw new Error(`build failed: ${last.error_message ?? '(no message)'}`);
      }
      return last.status;
    },
    { timeout: 90_000, intervals: [1000, 1000, 1000] },
  ).toBe('built');
  return last;
}

// visitorSeesPublishedContent -- UI-driven visit to the live page: the owner sees a
// "view live ↗" link in the admin custom-pages list (only appears after
// promote_to_live), clicking it jumps straight to /p/<slug>, and the visitor (in this
// case the admin owner themselves) sees the rendered React output.
async function visitorSeesPublishedContent(page: Page): Promise<void> {
  await gotoAdminSection(page, 'custom-pages');
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  await page.locator(`[data-testid="custom-page-row-${SLUG}"]`)
    .getByRole('link', { name: 'view live ↗' })
    .click();
  await page.waitForURL(`**/p/${SLUG}`, { timeout: 10_000 });
  await expect(page.getByTestId('custom-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(HELLO_MARKER, { exact: false })).toBeVisible();
  await expect(page.getByText(PAGE_TITLE, { exact: false })).toBeVisible();
}

async function ownerRollsBackToDefault(
  request: APIRequestContext, token: string, sid: string,
): Promise<void> {
  // rollback: sets live back to previous (there was no previous live version, so live
  // ends up cleared).
  await callTool<PagePayload>(request, token, sid, 'custom_page.rollback', { slug: SLUG });
}

// visitorSeesNotFoundAfterRollback -- after rollback, the "view live ↗" link on that row
// in admin custom-pages should disappear (has_live=false) -> replaced with "no live
// build" text. Verified at the UI surface, no longer hitting the URL directly via goto.
// The custom page (/p/<slug>) is a standalone React app with no admin nav. Getting back
// to admin from there uses `page.goBack()` -- equivalent to a real user "hitting back
// after viewing the live version".
async function visitorSeesNotFoundAfterRollback(page: Page): Promise<void> {
  await page.goBack();
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  // rollback goes through MCP, which the admin store doesn't know about; reload makes
  // the resource store re-fetch.
  await page.reload();
  const row = page.locator(`[data-testid="custom-page-row-${SLUG}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText('no live build')).toBeVisible();
  await expect(row.getByRole('link', { name: 'view live ↗' })).toHaveCount(0);
}
