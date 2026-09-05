// owner-sessions-panel.spec.ts —— the system section's active-sessions panel:
// list every place the owner is signed in, mark the current one, and revoke another.
//
// Ported from the youteacher auth session-card tests (list sessions + revoke one),
// adapted to this stack: one session is the admin browser, a second is a separate
// API login. The panel must show both, mark the browser's own as current, and
// revoking the other must actually kill its token server-side.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const SESSION_COOKIE = 'smt_session';

const OWNER = {
  email: 'sesspanel@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sesspanel',
  fullName: 'Sessions Panel Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner active-sessions panel', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('lists sessions, marks current, revokes another (its token then dies)',
    async ({ adminPage, playwright }) => {
      // a second login (a different "device") → a second owner session in Redis
      const other = await playwright.request.newContext();
      await loginAPI(other, OWNER.email, OWNER.password);
      const otherToken = await sessionCookieOf(other);
      expect(otherToken, 'second login has a session token').toBeTruthy();
      expect(await meStatus(playwright, otherToken)).toBe(200); // it's alive

      await gotoAdminSection(adminPage, 'system');
      await expect(adminPage.getByTestId('system-sessions')).toBeVisible();
      // more than one session shows (claim + admin browser + the second login), and
      // exactly one is marked the current device.
      await expect(adminPage.getByTestId('session-current')).toHaveCount(1);
      const before = await rows(adminPage).count();
      expect(before).toBeGreaterThanOrEqual(2);

      // revoke every non-current session (only non-current rows carry a revoke button);
      // this necessarily includes the second login, whose token must then be dead.
      await revokeAllOthers(adminPage);

      await expect.poll(() => meStatus(playwright, otherToken), { timeout: 5_000 }).toBe(401);
      // only the current device remains
      await expect(rows(adminPage)).toHaveCount(1, { timeout: 5_000 });
      await expect(revokeButtons(adminPage)).toHaveCount(0);
      await other.dispose();
    });
});

function rows(page: Page) {
  return page.locator('[data-testid^="session-row-"]');
}

function revokeButtons(page: Page) {
  return page.locator('[data-testid^="session-revoke-"]');
}

// revokeAllOthers — click every non-current session's revoke button, one at a time,
// waiting for the count to drop after each (the list reloads between clicks).
async function revokeAllOthers(page: Page): Promise<void> {
  for (let remaining = await revokeButtons(page).count(); remaining > 0; remaining -= 1) {
    await revokeButtons(page).first().click();
    await expect(revokeButtons(page)).toHaveCount(remaining - 1, { timeout: 5_000 });
  }
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function sessionCookieOf(ctx: APIRequestContext): Promise<string> {
  const state = await ctx.storageState();
  return state.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
}

async function meStatus(playwright: Playwright, token: string): Promise<number> {
  const ctx = await playwright.request.newContext();
  const res = await ctx.get(`${BACKEND}/api/admin/me`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });
  const status = res.status();
  await ctx.dispose();
  return status;
}
