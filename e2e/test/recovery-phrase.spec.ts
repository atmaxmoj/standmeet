// recovery-phrase.spec.ts —— #100 account recovery phrase.
//
// Self-service recovery for a forgotten password: while logged in, the owner generates a
// high-entropy recovery phrase -> only its hash is stored -> the plaintext is emailed to
// the owner's address (via the configured mail connector; the SMTP credential never
// leaves the vault). When locked out: the public /recover endpoint accepts
// {email, phrase}, matches it against the hash -> issues an owner session directly (log
// in and change the password). Single-use — spent once, then invalid. The public
// endpoint's brute-force surface is throttled by login-guard.
//
// RED (before implementation): neither /account/recovery nor /recover exists -> 404 ->
// assertions go red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI, navigateToOwnerLogin } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo,
} from '@/fixtures/mail';

const OWNER = {
  email: 'recover-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'recoverowner',
  fullName: 'Recover Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// extractPhrase — pulls the phrase out of the recovery email's body. The generating side
// puts the phrase on a line `phrase: <...>`.
function extractPhrase(body: string): string {
  const m = body.match(/phrase:\s*([A-Za-z0-9-]+)/);
  return m ? m[1]! : '';
}

async function generateRecovery(request: APIRequestContext, csrf: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/account/recovery`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return res.status();
}

async function recover(
  request: APIRequestContext, email: string, phrase: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/recover`, {
    data: { email, recovery_phrase: phrase },
  });
  return res.status();
}

async function meStatus(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BACKEND}/api/admin/me`);
  return res.status();
}

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await configureMailConnector(request, OWNER.email, OWNER.password);
  await request.dispose();
});

test.describe('account recovery phrase · #100', () => {
  test('generate → phrase emailed to owner; recover with it → logged in', async ({ playwright }) => {
    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await clearMailpit(admin);

    expect(await generateRecovery(admin, csrf), 'generate → 200').toBe(200);
    const mail = await waitForMailEnvelopeTo(admin, OWNER.email);
    const phrase = extractPhrase(mail.text);
    expect(phrase.length, 'recovery phrase emailed to owner').toBeGreaterThan(10);
    await admin.dispose();

    // Locked out: a brand-new context (no session), only email + phrase.
    const stranger = await playwright.request.newContext();
    expect(await meStatus(stranger), 'baseline: not logged in').toBe(401);
    expect(await recover(stranger, OWNER.email, phrase), 'recover with right phrase → 200').toBe(200);
    expect(await meStatus(stranger), 'recovered → session works').toBe(200);
    await stranger.dispose();
  });

  test('wrong phrase rejected; used phrase is single-use', async ({ playwright }) => {
    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await clearMailpit(admin);
    await generateRecovery(admin, csrf);
    const mail = await waitForMailEnvelopeTo(admin, OWNER.email);
    const phrase = extractPhrase(mail.text);
    await admin.dispose();

    const stranger = await playwright.request.newContext();
    expect(await recover(stranger, OWNER.email, 'not-the-phrase-xxxx'), 'wrong phrase → 401').toBe(401);
    expect(await recover(stranger, OWNER.email, phrase), 'right phrase → 200').toBe(200);
    // Single-use: the same phrase is rejected the second time.
    const again = await playwright.request.newContext();
    expect(await recover(again, OWNER.email, phrase), 'reused phrase → 401').toBe(401);
    await stranger.dispose();
    await again.dispose();
  });

  // Full-chain UI: a locked-out owner goes through the /recover page, fills in
  // email + phrase -> lands in /admin (logged back in).
  test('UI: /recover page signs a locked-out owner back in', async ({ page, playwright }) => {
    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await clearMailpit(admin);
    await generateRecovery(admin, csrf);
    const mail = await waitForMailEnvelopeTo(admin, OWNER.email);
    const phrase = extractPhrase(mail.text);
    await admin.dispose();

    await navigateToOwnerLogin(page);
    await page.getByTestId('recover-link').click();
    await page.waitForURL('**/recover', { timeout: 5_000 });
    await page.getByTestId('email').fill(OWNER.email);
    await page.getByTestId('recovery-phrase').fill(phrase);
    await page.getByTestId('submit').click();
    await page.waitForURL('**/admin', { timeout: 10_000 });
    expect(page.url(), 'landed in admin (recovered session)').toContain('/admin');
  });
});
