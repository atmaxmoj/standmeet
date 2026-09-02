// max-members.spec.ts -- the full browser flow for the name cap (defer-issue
// + name picker + full-code rejection + "N of M names" display + same-name
// session resume + name pre-fill from localStorage).
//
// User story:
//   the owner issues TEAM-2 (max_members=2). Alice scans the code, picks a
//   name, enters; the strip shows "1 / 2 names".
//   Bob scans the same code with a different name -> "2 / 2 names". A third
//   person (Carol) scans the same code and picks a name -> "code is full",
//   can't enter. Alice scans again (same name) -> the session resumes as usual.
//   The name is stored in localStorage: reopening in the same browser
//   auto-fills the name picker with the last-used name.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'maxmembers-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'maxmembersowner',
  fullName: 'Max Members Owner',
};

const CODE = 'TEAM-2';
// A separate unlimited-member code, used for the "name pre-fill" test --
// TEAM-2 is already full by the end of the first test.
const PREFILL_CODE = 'PREFILL-ANY';

test.describe('max_members: code caps how many names, with a clear full state', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('2 names fill the code, 3rd sees "code full", existing name resumes',
    async ({ browser }) => {
      // Alice (name 1) -> gets in, the strip shows 1 / 2 names.
      const aliceCtx = await browser.newContext();
      const alice = await aliceCtx.newPage();
      await enterCodeSession(alice, CODE, 'Alice');
      await expect(alice.getByTestId('session-strip-members-used')).toHaveText('1');
      await expect(alice.getByTestId('session-strip-names')).toContainText('/ 2');

      // Bob (name 2) -> gets in, 2 / 2.
      const bobCtx = await browser.newContext();
      const bob = await bobCtx.newPage();
      await enterCodeSession(bob, CODE, 'Bob');
      await expect(bob.getByTestId('session-strip-members-used')).toHaveText('2');

      // Carol (name 3) -> full, the name picker shows "code full", no session.
      const carolCtx = await browser.newContext();
      const carol = await carolCtx.newPage();
      await goto(carol, `/?code=${CODE}`);
      await carol.getByTestId('visitor-name-input').fill('Carol');
      await carol.getByTestId('visitor-name-submit').click();
      await expect(carol.getByTestId('visitor-name-full')).toBeVisible({ timeout: 10_000 });
      await expect(carol.getByTestId('session-strip')).toBeHidden();

      // Alice scans again with the same name -> session resumes, enters as
      // usual (does not consume a new member slot).
      const alice2Ctx = await browser.newContext();
      const alice2 = await alice2Ctx.newPage();
      await enterCodeSession(alice2, CODE, 'Alice');
      await expect(alice2.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      await aliceCtx.close();
      await bobCtx.close();
      await carolCtx.close();
      await alice2Ctx.close();
    });

  test('name is remembered in localStorage and pre-filled when a NEW code re-asks',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // First time: pick the name Dana to enter (using the unlimited-member
      // code). The name lands in localStorage.
      await enterCodeSession(page, PREFILL_CODE, 'Dana');
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Scanning **the same code** again won't re-pop the picker -- this is
      // deliberate (F-A-5, absorbFromURL's alreadyInNamedSession): reopening
      // a ?code= link shouldn't cover an active session with the identity
      // picker. So "pre-fill" has to be verified where it actually does pop:
      // switch to a **new code** (a new scenario -> clearNameDismiss -> the
      // picker asks again), and the input pre-fills the previous Dana.
      await goto(page, `/?code=${CODE}`);
      await expect(page.getByTestId('visitor-name-input')).toHaveValue('Dana');
      await ctx.close();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'maxmembers-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, { body: 'team intro.', title: 'Intro' });
  await createCode(request, csrf, {
    code: CODE, label: 'Team of 2', max_members: 2,
  });
  await createCode(request, csrf, { code: PREFILL_CODE, label: 'Prefill (unlimited)' });
  await request.dispose();
}
