// navigate.ts —— page navigation helper (shared across specs).
//
// An eslint rule confines page.goto to helper/, so specs don't teleport inside the
// test body. This centralizes all goto calls, and specs use semantic functions.
//
// v1 is a single-owner instance —— the public page hangs directly off root /, with
// no handle in the URL.

import { type Page } from '@playwright/test';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

// SESSION_OPEN_TIMEOUT_MS —— the patience for waiting on /sessions 200; it must be
// **greater than the server's own budget for dialing the plugins** (20s, see
// `plugin dial ... budget=20s`). This once read 15s —— shorter than the server's
// budget, so a legitimate cold start (measured at 21.8s: three sandboxes'
// first-time spawn+initialize) could never be reached.
//
// And the consequence isn't just "this case went red": the client gives up → the
// browser closes → the request is aborted → the server's three dials receive
// `parent-canceled(caller gave up first)` → the session **opens anyway**, just with
// every capability "hidden from this session". So the failure message points at the
// session not opening, while the truth is we cut it off ourselves.
const SESSION_OPEN_TIMEOUT_MS = 30_000;

// goto —— any relative path (including a query). eslint confines page.goto to
// helper/. The caller passes things like "/setup?t=xxx", "/login", "/alice".
//
// **Wait for `load` —— don't switch it to `domcontentloaded`.** I changed it once to
// fix a timeout, and that change **hides a real defect**: `role-waypoints-admin`'s
// 0-width input (F-A-43) only happens after the web fonts have actually finished
// loading —— that is, **the moment a real person sees it**. After switching to
// domcontentloaded, what got measured was the layout under fallback fonts, four
// cases went green, and the defect was still on the page. A real person always
// looks at the page after load; the criterion has to stand there too.
export async function goto(page: Page, path: string): Promise<void> {
  const url = path.startsWith('/') ? `${APP_BASE}${path}` : `${APP_BASE}/${path}`;
  await page.goto(url);
}

// gotoOnHost —— the same instance, opened from a different **origin** (F-D-14).
//
// The browser treats `localhost` / `127.0.0.1` as a secure context; other hostnames
// over http are not. And a real visitor and the owner necessarily open this
// instance from another machine —— so some behaviors **only hold on a non-localhost
// origin**, which the default baseURL can't drive. The host is pointed back at this
// machine by the caller via `--host-resolver-rules`.
export async function gotoOnHost(page: Page, host: string, path: string): Promise<void> {
  const base = APP_BASE.replace(/\/\/[^:/]+/, `//${host}`);
  await page.goto(`${base}${path.startsWith('/') ? path : `/${path}`}`);
}

// enterCodeSession —— get a code session via the `?code=` entry.
//
// After defer-issue, /sessions isn't sent at scan time but when the name picker
// **picks a name (or skips)**. So the entry sequence is fixed: goto → name picker
// appears → fill + submit a name (or skip) → wait for /sessions 200. A string name =
// use that name (a named member); omitted = skip (anonymous).
export async function enterCodeSession(
  page: Page, code: string, name?: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  // Only wait for 200, but **record the non-200s along the way**. Only accepting 200
  // as the wait condition is right (the session is only "in" once it's built), but it
  // filters out the real cause: when the backend keeps returning 401 / 429, the
  // timeout message only says "no response", so a clear rejection disguises itself as
  // a hang. That's exactly what happened in the 2026-08-02 full run —— the backend
  // returned 10×401 + 15×429 within 4 seconds, and not one status code showed in the
  // failure message.
  const seen: number[] = [];
  const note = (r: { url: () => string; status: () => number }) => {
    if (r.url().endsWith('/api/v1/sessions') && r.status() !== 200) seen.push(r.status());
  };
  page.on('response', note);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200,
    { timeout: SESSION_OPEN_TIMEOUT_MS },
  );
  await submitVisitorName(page, name);
  try {
    await session;
  } catch (e) {
    const detail = seen.length > 0 ? ` — backend answered ${seen.join(',')}` : ' — no response at all';
    throw new Error(`enterCodeSession(${code}): no 200 from /api/v1/sessions${detail}`, { cause: e });
  } finally {
    page.off('response', note);
  }
}

// submitVisitorName —— the name picker: with a name, fill + submit; without one, skip.
async function submitVisitorName(page: Page, name?: string): Promise<void> {
  const skip = page.getByTestId('visitor-name-skip');
  await skip.waitFor({ state: 'visible', timeout: 15_000 });
  if (name === undefined || name === '') {
    await skip.click();
    return;
  }
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
}

// gotoAdminSection —— click a section's nav link in the admin sidebar.
// Matched by testid (data-testid="admin-nav-<slug>"), unaffected by design changing
// the label / reordering the sidebar.
export async function gotoAdminSection(page: Page, slug: string): Promise<void> {
  await page.getByTestId(`admin-nav-${slug}`).click();
  // Wait for the URL to actually land, don't just click the link and move on.
  // Previously most tests looked for something specific to the target page as their
  // first step (which waits on its own), so this gap stayed hidden. After the landing
  // page changed from /admin/page to /admin/dashboard, **every** gotoAdminSection
  // starts on the dashboard —— and the dashboard's h1 ("dashboard · last refresh ·
  // now") is an immediately-visible level-1 heading, so any "click raw then assert
  // h1" case would grab the **old page**'s jumped-the-gun h1 (that's how UX-12 went red).
  await page.waitForURL(`**/admin/${slug}`, { timeout: 10_000 });
}

// reloadAdminSection —— a **full-page reload** of /admin/<slug>, rather than
// clicking the sidebar.
//
// The two observe different things: `gotoAdminSection` is a client-side transition,
// and a cache that's already ready in the store isn't refetched, so "what happens
// when the mount-time fetch fails" can't be triggered at all —— that's how F-N-2's
// first guard went green on unfixed code, green because the fault was never
// injected. What the owner hits is exactly this reload scene: the server went down,
// he refreshes, or opens a fresh tab the next day.
export async function reloadAdminSection(page: Page, slug: string): Promise<void> {
  await page.goto(`/admin/${slug}`);
}
