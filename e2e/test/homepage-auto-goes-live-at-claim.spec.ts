// homepage-auto-goes-live-at-claim.spec.ts — A Slice 5 (auto-go-live).
//
// Claiming an instance installs the DefaultHomepage as a draft AND queues its build. The build,
// once the builder finishes it, is promoted to live automatically (event-driven, on MarkBuilt), so
// the owner's homepage is up at `/` with nothing to click. This drives that whole path: claim, then
// wait for `/api/v1/homepage` to go live on its own (no publish call from the test), then confirm
// the site root serves the DefaultHomepage.
//
// RED if auto-go-live regresses: the home page would stay a draft forever, /api/v1/homepage would
// never leave 404, and `/` would keep the built-in page.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'autolive@example.com', password: 'correct-horse-battery-staple',
  handle: 'autolive', fullName: 'Auto Live Owner',
};

// A distinctive line from the DefaultHomepage template (defaulthomepage/App.tsx HERO).
const HOME_HERO = 'I think out loud here';

test.describe.configure({ timeout: 420_000 });

test.describe('A Slice 5 · the homepage auto-goes-live at claim', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('after claim the DefaultHomepage goes live at `/` with no manual publish', async ({
    page, request,
  }) => {
    // No publish call here — the build was queued at claim and auto-promotes when it finishes.
    await expect.poll(
      async () => (await request.get(`${BACKEND}/api/v1/homepage`)).status(),
      { message: 'the home page must go live on its own', timeout: 360_000, intervals: [3000] },
    ).toBe(200);

    await goto(page, '/');
    await expect(page.getByText(HOME_HERO, { exact: false }).first())
      .toBeVisible({ timeout: 20_000 });
  });
});
