// dashboard-requests-kpi.spec.ts —— F-C-19: the dashboard's REQUESTS figure must match the real pending-request count.
//
// It counts `status === 'new'`, while the backend actually emits `'open'` (the
// domain vocabulary is `'open' | 'replied' | 'closed'` — `'new'` never
// exists). So this KPI is **stuck at 0** — no matter how many are pending.
//
// 0 looks like a perfectly normal number, and the subtitle even backs it up
// ("at zero · from gate" reads like "genuinely nobody came"), so this class of
// bug only shows up when **two views of the same data are placed side by
// side**: the sidebar badge counts `'open'`, and it counts correctly.
//
// The criterion is **the two views must agree**, not "equals 1" — the former
// still holds once the request count changes later, or once a third view is
// added. Assert non-empty first (there really is one pending request),
// otherwise "both sides are 0" would also pass the consistency check — a false
// green from an empty set.
//
// RED (before the fix): sidebar 1, dashboard 0 → mismatch, red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'kpi@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'kpiowner',
  fullName: 'KPI Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await submitAccessRequest(request);
  await request.dispose();
});

test.describe('dashboard · the REQUESTS figure counts real pending requests (F-C-19)', () => {
  test('the dashboard tile agrees with the sidebar badge', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'dashboard');

    const badge = adminPage.getByTestId('badge-requests');
    // Non-empty guard: prove first that a request really is pending, otherwise "both sides are 0" would make the consistency assertion below a false green.
    await expect(badge, 'guard: one request really is pending').toHaveText('1', { timeout: 10_000 });

    const tile = adminPage.getByTestId('kpi-requests');
    await expect(
      tile,
      'the dashboard REQUESTS figure must match the pending requests the sidebar counts',
    ).toContainText('1');
  });
});

// submitAccessRequest — files a request via the gate's no-code path (hits the public endpoint, no browser needed).
async function submitAccessRequest(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/access-requests`, {
    data: {
      name: 'Dana Whitfield',
      org: 'Northwind Labs',
      email: 'dana@example.com',
      message: 'I would like to talk about verification harnesses.',
    },
  });
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`access-request: ${res.status()} ${await res.text()}`);
  }
}

export type { Playwright };
