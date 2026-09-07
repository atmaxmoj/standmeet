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

// readEvents —— the recorded rows, newest first.
export async function readEvents(
  request: APIRequestContext,
  owner: { email: string; password: string },
  filter: EventFilter = {},
): Promise<MonitorEvent[]> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const res = await request.get(`/api/admin/monitor/events?${qs.toString()}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`monitor events ${res.status()}: ${await res.text()}`);
  return (await res.json() as { events: MonitorEvent[] }).events;
}

// readSummary —— the numbers at the top of the panel.
export async function readSummary(
  request: APIRequestContext,
  owner: { email: string; password: string },
): Promise<MonitorSummary> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/monitor/stats', {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`monitor stats ${res.status()}: ${await res.text()}`);
  return await res.json() as MonitorSummary;
}
