// monitor-index-visit.spec.ts —— a real browser opens the index, and the owner sees it.
//
// The other beacon spec posts to the endpoint directly, which proves the endpoint. This one
// proves the WIRING: that the page actually mounts the tracker, that it fires on load, and that
// what arrives is attributed to the index. A component nobody rendered passes every endpoint
// test ever written.
//
// This is the surface with no server-side signal at all: `/` is rendered by the app, and the
// only backend route involved is a liveness probe that fires whether or not a person is there.
// If this file goes red, the owner's own front page is invisible to them.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { readEvents } from '@/fixtures/monitor';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'monitor-index@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorindex',
  fullName: 'Monitor Index',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · a browser opening the index is recorded', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('the visit reaches the panel', async ({ browser, adminPage, request }) => {
    // A brand-new context: no owner cookies, so this is a stranger, not the owner.
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    // The shared helper waits for load, not domcontentloaded: the beacon fires from an effect
    // after mount, and a real person always looks at the page after load.
    await goto(page, '/');
    // The beacon fires from an effect after mount; wait for the row rather than for a timer.
    await expect.poll(
      async () => (await readEvents(request, OWNER, { surface: 'index' })).length,
      { message: 'the index visit must be recorded' },
    ).toBeGreaterThan(0);
    await visitor.close();

    // Find the VIEW specifically. Taking the newest row assumes nothing else fired after it,
    // and something did the first time this ran: a short page reported scroll depth too.
    const rows = await readEvents(request, OWNER, { surface: 'index' });
    const view = rows.find((r) => r.event_name === '');
    expect(view, 'the index view must be among the recorded events').toBeTruthy();
    expect(view?.url_path).toBe('/');
    expect(view?.is_bot, 'a real browser is not a crawler').toBe(false);

    // And the owner sees it on the panel, which is the whole point.
    await gotoAdminSection(adminPage, 'monitor');
    await expect(adminPage.getByTestId('stat-views-value')).not.toHaveText('0');
    await expect(adminPage.getByTestId('monitor-feed')).toContainText('index');
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
