// monitor.ts —— reading back what the monitor domain recorded.
//
// Every monitor spec asserts against a ROW, never against the response of the request that was
// supposed to produce it. A public page answers 200 whether or not it was recorded, so a 200 is
// not a receipt; the row is.

import { expect } from '@playwright/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';

export interface MonitorEvent {
  event_id: string;
  viewer_id: string;
  visit_id: string;
  created_at: string;
  surface: string;
  event_name: string;
  is_bot: boolean;
  url_path: string;
  page_title: string;
  referrer_domain: string;
  src: string;
  entity_kind: string;
  entity_id: string;
  entity_title: string;
  code_id: string;
  code_label: string;
  browser: string;
  os: string;
  device: string;
  country: string;
  bot_name: string;
  props: Record<string, string>;
}

export interface MonitorSummary {
  viewers: number;
  visits: number;
  views: number;
  events: number;
  bots: number;
}

export interface EventFilter {
  surface?: string;
  event?: string;
  entity_id?: string;
  include_bots?: boolean;
  limit?: number;
  // window —— '7d' | '28d' | '90d'. Omitted means the backend's default (28d), which is what an
  // owner opening the panel sees.
  window?: string;
}

// A user agent that is NOT a bot. Playwright's own context sends a HeadlessChrome agent, which
// the bot filter correctly rejects — so a spec that wants to be counted as a person must say so.
export const HUMAN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// visitAsStranger —— one request from a context that shares nothing with the owner's session.
//
// A spec must NOT reuse the `request` fixture for this. `readEvents` signs in, which puts the
// owner's CSRF cookie on that context, and from then on every request it makes is correctly
// excluded as the owner's own browsing (monitor.md §4.11). A spec that keeps using it records
// nothing further and passes only on rows captured before its first login.
//
// baseURL must be passed explicitly: a context from newContext() inherits nothing from the
// config, so a relative path reaches no server at all — and "nothing was recorded" then looks
// identical to a broken recorder. The status assertion is what tells those apart.
export async function visitAsStranger(
  pw: Playwright, path: string, userAgent: string = HUMAN_UA, expectStatus = 200,
): Promise<void> {
  const ctx = await pw.request.newContext({
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:38127',
    extraHTTPHeaders: { 'User-Agent': userAgent },
  });
  const res = await ctx.get(path);
  await ctx.dispose();
  expect(res.status(), `a visitor request must reach the server: ${path}`).toBe(expectStatus);
}

// csrfCache —— one sign-in per owner per worker.
//
// These readers are called from polls, and a poll that signs in on every tick trips the login
// rate limiter: the spec then fails with `login failed: 429`, which reads as "the panel is
// broken" rather than "the harness knocked too often". The session cookie is already on the
// context after the first sign-in; only the CSRF token needs keeping.
const csrfCache = new Map<string, string>();

async function csrfFor(
  request: APIRequestContext, owner: { email: string; password: string },
): Promise<string> {
  const cached = csrfCache.get(owner.email);
  if (cached !== undefined) return cached;
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  csrfCache.set(owner.email, csrf);
  return csrf;
}

// ownerGET —— one owner-authenticated read, re-signing in once if the cached session went stale.
//
// The retry is bounded to one attempt and only on an auth refusal: a spec that resets the
// instance mid-run invalidates the cached token, and without this the next read fails as "403"
// — a message that points at the endpoint rather than at the sign-in that expired.
async function ownerGET(
  request: APIRequestContext, owner: { email: string; password: string }, path: string,
) {
  const first = await request.get(path, {
    headers: { 'X-Csrftoken': await csrfFor(request, owner) },
  });
  if (first.status() !== 401 && first.status() !== 403) return first;
  csrfCache.delete(owner.email);
  return request.get(path, { headers: { 'X-Csrftoken': await csrfFor(request, owner) } });
}

// readEvents —— the recorded rows, newest first.
export async function readEvents(
  request: APIRequestContext,
  owner: { email: string; password: string },
  filter: EventFilter = {},
): Promise<MonitorEvent[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const res = await ownerGET(request, owner, `/api/admin/monitor/events?${qs.toString()}`);
  if (!res.ok()) throw new Error(`monitor events ${res.status()}: ${await res.text()}`);
  return (await res.json() as { events: MonitorEvent[] }).events;
}

// readSummary —— the numbers at the top of the panel.
export async function readSummary(
  request: APIRequestContext,
  owner: { email: string; password: string },
  window = '',
): Promise<MonitorSummary> {
  const res = await ownerGET(request, owner, `/api/admin/monitor/stats?window=${window}`);
  if (!res.ok()) throw new Error(`monitor stats ${res.status()}: ${await res.text()}`);
  return await res.json() as MonitorSummary;
}
