// second-code-switch-microsite.spec.ts —— the StandMeet spec (2026-11-10) acceptance, the owner's
// exact scenario: two access codes, each bound to its own microsite. Presenting a second code in the
// same window must SWITCH the session and land on the new code's page — not report "access granted"
// and keep the old code's chat. Before the fix, presenting B sat on an "access granted · code B"
// picker while A's session stayed active; now it auto-switches to B and lands on /p/<B>.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode, setCodeMicrosite } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = { email: 'twoswitch@example.com', password: 'correct-horse-battery-staple', handle: 'twoswitch', fullName: 'Two Switch' };
const CODE_A = 'SITEA-AAA1';
const CODE_B = 'SITEB-BBB2';
const SLUG_A = 'sitea-page';
const SLUG_B = 'siteb-page';
const NAME = 'Recruiter Rhea';
const pageSrc = (label: string) => `
import React from 'react';
import { AgentWidget } from '@standmeet/sdk';
export default function App() { return <main className="p-8"><h1 data-testid="site-title">${label}</h1><AgentWidget /></main>; }
`.trim();

async function api(request: APIRequestContext, csrf: string, method: 'get'|'post'|'put', path: string, data?: unknown) {
  const url = `${BACKEND}/api/admin/microsites${path}`;
  const opts = { headers: { 'X-Csrftoken': csrf }, ...(data === undefined ? {} : { data }) };
  const res = await request[method](url, opts);
  return { status: res.status(), body: res.ok() ? (await res.json()) as Record<string, unknown> : {} };
}

async function publishPage(request: APIRequestContext, csrf: string, slug: string, src: string): Promise<void> {
  await api(request, csrf, 'post', '/', { slug, title: slug });
  await api(request, csrf, 'put', `/${slug}/files`, { path: 'App.tsx', content: src });
  const started = await api(request, csrf, 'post', `/${slug}/build`);
  expect(started.status, 'start build ' + slug).toBe(200);
  const id = started.body['build_id'] as string;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = (await api(request, csrf, 'get', `/builds/${id}`)).body;
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = typeof row['error_message'] === 'string' ? row['error_message'] : '';
  expect(row['status'], why).toBe('built');
  expect((await api(request, csrf, 'post', `/${slug}/live`, { build_id: id })).status).toBe(200);
}

// present —— present a code at `/?code=`. First time (no session) → the name picker; fill it. A
// switch (already in a session) → the auto-switch "switching" notice; nothing to fill. Either way
// wait until it lands on the given microsite slug.
async function present(page: Page, code: string, slug: string): Promise<void> {
  await openReader(page, `/?code=${code}`);
  const input = page.getByTestId('visitor-name-input');
  const switching = page.getByTestId('visitor-code-switching');
  await input.or(switching).first().waitFor({ state: 'visible', timeout: 20_000 });
  if (await input.isVisible()) {
    await input.fill(NAME);
    await page.getByTestId('visitor-name-submit').click();
  }
  await page.waitForURL((u) => u.pathname.includes(`/p/${slug}`), { timeout: 30_000 });
}

test.describe.configure({ timeout: 600_000 });
test.describe('presenting a second microsite-bound code switches to its page', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(600_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const a = await createCode(request, csrf, { code: CODE_A, label: 'A', max_turns_per_session: 50, max_members: 10 });
    const b = await createCode(request, csrf, { code: CODE_B, label: 'B', max_turns_per_session: 50, max_members: 10 });
    await publishPage(request, csrf, SLUG_A, pageSrc('Site A'));
    await publishPage(request, csrf, SLUG_B, pageSrc('Site B'));
    await setCodeMicrosite(request, csrf, a.id, SLUG_A);
    await setCodeMicrosite(request, csrf, b.id, SLUG_B);
    await request.dispose();
  });

  test('A1→A2→A4 switches land on each code’s page; A6 direct nav does not show A on B', async ({ page }: { page: Page }) => {
    test.setTimeout(180_000);

    // A1: fresh → present A → lands on A's microsite, agent adopts A inline.
    await present(page, CODE_A, SLUG_A);
    await expect(page.getByTestId('site-title')).toHaveText('Site A');
    await expect(page.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

    // A2: present B in the same window → SWITCHES, lands on B's page (the defect was staying on A).
    await present(page, CODE_B, SLUG_B);
    await expect(page.getByTestId('site-title')).toHaveText('Site B');
    await expect(page.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

    // A4: present A again → back to A's page (idempotent return).
    await present(page, CODE_A, SLUG_A);
    await expect(page.getByTestId('site-title')).toHaveText('Site A');

    // A6: holding A, navigate DIRECTLY to B's page without presenting B → must not show A's chat on
    // B's page; the backend gates it to /gate.
    await openReader(page, `/p/${SLUG_B}/`);
    await page.waitForURL((u) => u.pathname.includes('/gate'), { timeout: 20_000 });
  });
});
