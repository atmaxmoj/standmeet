// account-email-pending-lifecycle.spec.ts — the pending email change, every state it can sit in,
// from birth to death.
//
// `account-email-change-needs-confirmation.spec.ts` only walks the happy path: request → receive
// mail → click → swap. But a pending state **can sit there for a long time**, and everything keeps
// running normally while it sits — who does the recovery phrase go to? What if a second request
// comes in? Can the owner see it in the panel? What about backing out? If any of these squares is
// empty, the "can't lock yourself out" guarantee has a hole in it.
//
// Overall criterion: **while pending, identity and the recovery channel must both still point at
// the old address.** The new address hasn't been proven yet — handing either one to it early just
// moves the hole, not closes it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, PlaywrightWorkerArgs } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance } from '@/fixtures/instance';
import {
  clearMailpit, configureMailConnector, confirmLinkIn, followMailedLink,
  mailpitHasNothingTo, waitForMailTo,
} from '@/fixtures/mail';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

// PW — the `playwright` from the worker fixture. Test bodies are extracted into module-level
// functions (max-lines-per-function), so its type has to be spelled out.
type PW = PlaywrightWorkerArgs['playwright'];

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pending@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pending',
  fullName: 'Pat Pending',
};
const FIRST = 'pending+first@example.com';
const SECOND = 'pending+second@example.com';

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, { data: { email, password } });
  return res.status();
}

async function requestChange(
  request: APIRequestContext, csrf: string, newEmail: string,
): Promise<number> {
  const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: OWNER.password, new_email: newEmail },
  });
  return res.status();
}

function pendingColumn(): string {
  return querySQL(`SELECT coalesce(pending_email, '') FROM owners WHERE handle = '${OWNER.handle}'`);
}

async function openAccount(page: Page): Promise<void> {
  await gotoAdminSection(page, 'account');
  await page.waitForURL('**/admin/account', { timeout: 5_000 });
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('account · the pending email change, every state it can sit in', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await clearMailpit(request);
    await request.dispose();
    execSQL(
      `UPDATE owners SET pending_email = NULL, pending_email_token_hash = '', ` +
      `pending_email_expires_at = NULL WHERE handle = '${OWNER.handle}'`,
    );
  });

  test('while a change is pending, the recovery phrase still goes to the OLD address',
    ({ playwright }) => recoveryStaysOnTheOldAddress(playwright));

  test('the panel shows the pending address, and the owner can cancel it',
    ({ adminPage }) => panelShowsAndCancels(adminPage));

  test('a second request replaces the first, and the first link is dead',
    ({ adminPage, playwright }) => secondRequestKillsTheFirst(adminPage, playwright));

  test('an expired link is refused, and the page says it expired',
    ({ adminPage, playwright }) => expiredLinkIsRefused(adminPage, playwright));

  test('a garbage or missing token gets a readable page, not a crash',
    ({ adminPage }) => garbageTokenIsReadable(adminPage));

  test('changing the password does not disturb a pending email change',
    ({ playwright }) => passwordChangeLeavesPendingAlone(playwright));
});

// ── body ────────────────────────────────────────────────────────────

// While sitting in pending, the recovery channel must still be the old address.
async function recoveryStaysOnTheOldAddress(playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  expect(await requestChange(request, csrf, FIRST)).toBe(200);
  await clearMailpit(request);

  const res = await request.post(`${BACKEND}/api/admin/account/recovery`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  expect(res.status()).toBe(200);

  // It went to the old address.
  expect((await waitForMailTo(request, OWNER.email)).length).toBeGreaterThan(0);
  // And it was **not** also sent to the new, not-yet-proven address.
  expect(await mailpitHasNothingTo(request, FIRST),
    '恢复短语寄给了还没被证明的新地址 —— 洞只是换了个位置').toBe(true);
  await request.dispose();
}

// The owner can see it, and can back out of it. An invisible pending state means not knowing
// whether the click they made actually took effect.
async function panelShowsAndCancels(page: Page): Promise<void> {
  await openAccount(page);
  await page.getByTestId('account-email-current-password').fill(OWNER.password);
  await page.getByTestId('account-email-new').fill(FIRST);
  await page.getByTestId('account-email-confirm').fill(FIRST);
  await page.getByTestId('account-email-save').click();

  await expect(page.getByTestId('account-email-pending')).toContainText(FIRST);
  await page.getByTestId('account-email-pending-cancel').click();
  await expect(page.getByTestId('account-email-pending')).toBeHidden();
  expect(pendingColumn(), '取消只把它从屏幕上藏起来，库里还留着').toBe('');
}

// If both mail links stayed usable, the owner would believe the change went to SECOND while some
// stale tab, one click, would send it to FIRST instead.
async function secondRequestKillsTheFirst(
  page: Page, playwright: PW,
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);

  expect(await requestChange(request, csrf, FIRST)).toBe(200);
  const firstLink = confirmLinkIn(await waitForMailTo(request, FIRST), 'confirm-email');

  await clearMailpit(request);
  expect(await requestChange(request, csrf, SECOND)).toBe(200);
  await waitForMailTo(request, SECOND);

  await followMailedLink(page, firstLink);
  await expect(page.getByTestId('email-confirmed')).toBeHidden();
  expect(await loginStatus(request, FIRST, OWNER.password)).toBe(401);
  expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
  await request.dispose();
}

// It must say **expired**, not "invalid link" — what the owner should do next depends on the
// difference between those two words.
async function expiredLinkIsRefused(
  page: Page, playwright: PW,
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  expect(await requestChange(request, csrf, FIRST)).toBe(200);
  const link = confirmLinkIn(await waitForMailTo(request, FIRST), 'confirm-email');

  // There's no API that can produce the "already expired" state, nor should there be one.
  execSQL(
    `UPDATE owners SET pending_email_expires_at = now() - interval '1 hour' ` +
    `WHERE handle = '${OWNER.handle}'`,
  );

  await followMailedLink(page, link);
  await expect(page.getByTestId('email-confirm-expired')).toBeVisible({ timeout: 10_000 });
  expect(await loginStatus(request, FIRST, OWNER.password)).toBe(401);
  expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
  await request.dispose();
}

async function garbageTokenIsReadable(page: Page): Promise<void> {
  // Use the goto fixture instead of hand-building the host — an earlier version hardcoded :3000
  // (the in-container port), while the app is exposed at :38127, so the failure was a connection
  // refused, unrelated to whether the page's copy is human-readable.
  await goto(page, '/confirm-email?token=nope');
  await expect(page.getByTestId('email-confirm-invalid')).toBeVisible({ timeout: 10_000 });
  // No raw error may appear in the UI — the CLAUDE.md rule "errors must be human readable".
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/panic|goroutine|sql:|pgx|500 Internal/i);
}

// Changing the password and changing the email are two separate things; neither should swallow
// the other.
async function passwordChangeLeavesPendingAlone(
  playwright: PW,
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  expect(await requestChange(request, csrf, FIRST)).toBe(200);

  const newPassword = 'another-correct-horse-9876';
  const res = await request.patch(`${BACKEND}/api/admin/account/password`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: OWNER.password, new_password: newPassword },
  });
  // The password-change route uses noContent — success is 204, not 200.
  expect(res.status()).toBe(204);

  expect(pendingColumn()).toBe(FIRST);
  expect(await loginStatus(request, OWNER.email, newPassword)).toBe(200);

  // Reset it, so later tests in this file aren't affected.
  const fresh = await login(request, OWNER.email, newPassword);
  await request.patch(`${BACKEND}/api/admin/account/password`, {
    headers: { 'X-Csrftoken': fresh.csrf },
    data: { current_password: newPassword, new_password: OWNER.password },
  });
  await request.dispose();
}
