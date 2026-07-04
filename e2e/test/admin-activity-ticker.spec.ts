// admin-activity-ticker.spec.ts —— Monitor/observability。ActivityTicker(TopBar 事件流)接真
// GET /api/admin/stats/activity:从现有行(corpus 写入 / visitor session / booking / code 兑换)
// 派生最近 N 条,最新在前。RED 直到端点落地(现在 404)。绿=ticker 显真事件,不再 "coming soon"。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';
// (APIRequestContext used for the adminPage.request typing below.)

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'alice@example.com', password: 'test-password-1234',
  handle: 'alice', fullName: 'Alice',
};

interface Activity { events: { kind: string; at: string; label: string }[] }

async function seedEvents(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'activity-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, { title: 'Activity Corpus Doc', body: 'activity ingest content' }); // ingest event
  const code = await createCode(request, csrf, { code: 'ACT-EVT1', label: 'act' });
  await issueSession(request, {                                          // visitor event
    handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'ActVisitor',
  });
  await request.dispose();
}

async function getActivity(authed: APIRequestContext): Promise<Activity> {
  const res = await authed.get(`${BACKEND}/api/admin/stats/activity?limit=20`);
  expect(res.status(), 'activity endpoint 200').toBe(200);
  return await res.json() as Activity;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · ActivityTicker recent-events stream', () => {
  test.beforeAll(async ({ playwright }) => { await seedEvents(playwright); });

  test('GET /api/admin/stats/activity derives real recent events, newest first',
    async ({ adminPage }) => {
      const a = await getActivity(adminPage.request);
      expect(a.events.length, 'has real events').toBeGreaterThan(0);
      const kinds = a.events.map((e) => e.kind);
      expect(kinds, 'a visitor-session event surfaced').toContain('visitor');
      expect(kinds, 'a corpus ingest event surfaced').toContain('ingest');
      // newest-first: timestamps monotonically non-increasing.
      const ts = a.events.map((e) => Date.parse(e.at));
      expect(ts, 'valid timestamps').not.toContain(NaN);
      for (let i = 1; i < ts.length; i++) {
        expect(ts[i - 1], 'newest first').toBeGreaterThanOrEqual(ts[i] ?? 0);
      }
      a.events.forEach((e) => expect(e.label, 'each event has a human label').toBeTruthy());
    });

  test('ActivityTicker shows a real event, not the coming-soon placeholder',
    async ({ adminPage }) => {
      const ticker = adminPage.getByTestId('activity-ticker');
      await expect(ticker).toBeVisible();
      await expect(ticker).not.toContainText(/coming soon/i);
    });
});
