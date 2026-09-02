// gate-refusal-names-its-kind.spec.ts -- F-D-6: every refusal must name its own kind.
//
// For someone holding a code, "mistyped it" and "the owner revoked it" call for **opposite**
// actions: the former just retypes it, the latter should stop trying and ask for a new one.
// But the gate returns the same string, `access code invalid or revoked`, for both -- neither
// person knows what to do next.
//
// The distinction is gone at the data layer: `codes_query.go`'s GetByCode only queries
// active rows, so "revoked" and "doesn't exist" both come back as no-rows, collapsing into
// the same ErrCodeInvalid. So this isn't a copy problem, it's that the sentence **can never
// be written** as things stand.
//
// This test goes through the GUI, reading the exact string the visitor sees -- what code the
// backend returns is an implementation detail; what the visitor sees is the wording.
//
// The "full" case is already correct (`this code is full`); this test locks that in too --
// it is exactly the kind of case this item names as something to protect ("a valid invite
// gets reported as a bad code"), and it must not get folded back together while fixing the
// revoked case.
//
// RED (before the fix): the revoked case reads back the exact same sentence as "doesn't
// exist" -> the second test fails.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'refusal@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'refusal',
  fullName: 'Refusal Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const LIVE_CODE = 'REFUSE-LIVE';
const REVOKED_CODE = 'REFUSE-GONE';
const FULL_CODE = 'REFUSE-FULL';

let seeded: { request: APIRequestContext; csrf: string } | null = null;

test.beforeAll(async ({ playwright }) => {
  // Setup opens a real session (to take that one seat), and opening a session means a
  // serial cold-start of the sandbox -- on a fresh instance this blows well past the default
  // 30s hook limit. What's being widened is the time for **setup**, not for the assertion.
  test.setTimeout(180_000);
  seeded = await setup(playwright);
});

test.afterAll(async () => {
  await seeded?.request.dispose();
});

test.describe('gate · every refusal names its own kind (F-D-6)', () => {
  test('a code that does not exist says so', async ({ page }) => {
    const msg = await refusalFor(page, 'NOSUCH-999', 'Stranger');
    expect(msg, 'an unknown code must be reported as unknown').toMatch(/invalid|unknown|no such/i);
  });

  test('a revoked code does not read the same as an unknown one', async ({ page }) => {
    const unknown = await refusalFor(page, 'NOSUCH-998', 'Stranger');
    const revoked = await refusalFor(page, REVOKED_CODE, 'Holder');

    // Assert "the two strings differ", not any specific wording -- wording is the product's
    // choice, "being distinguishable" is the invariant.
    expect(
      revoked,
      'a revoked code and an unknown code must not read identically — '
      + 'one means retype it, the other means ask for a new one',
    ).not.toBe(unknown);
    // And it must actually say "revoked" -- not just be a different phrasing of the same meaning.
    expect(revoked, 'the revoked case must name revocation').toMatch(/revok|withdraw|no longer/i);
  });

  test('a full code is still reported as full, not as a bad code', async ({ page }) => {
    // This is exactly the kind of case the item names as something to protect: a valid
    // invite reported as a bad code. Must not get merged back in while fixing the revoked case.
    const msg = await refusalFor(page, FULL_CODE, 'SecondSeat');
    expect(msg, 'a full code must say it is full').toMatch(/full/i);
  });
});

// refusalFor -- fills in code + name on the gate, submits, and reads back the exact refusal
// text the visitor sees.
async function refusalFor(page: Page, code: string, name: string): Promise<string> {
  await goto(page, '/gate');
  await page.getByTestId('gate-code').fill(code);
  await page.getByTestId('gate-visitor-name').fill(name);
  await page.getByTestId('gate-code-submit').click();
  // gate-error appears more than once on the page (one in the code panel, one in the request panel); scope down to the one in the code panel.
  const err = page.getByTestId('code-panel').getByTestId('gate-error');
  await expect(err, 'the gate must show a refusal').toBeVisible({ timeout: 10_000 });
  return (await err.innerText()).trim();
}

async function setup(playwright: Playwright): Promise<{ request: APIRequestContext; csrf: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: LIVE_CODE, label: 'live' });
  // Full: capacity of 1, used up first.
  await createCode(request, csrf, { code: FULL_CODE, label: 'full', max_members: 1 });
  await enterOnce(request, FULL_CODE, 'FirstSeat');
  // Revoked: created, then revoked.
  const gone = await createCode(request, csrf, { code: REVOKED_CODE, label: 'gone' });
  const res = await request.post(`${BACKEND}/api/admin/codes/${gone.id}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`revoke: ${res.status()}`);
  return { request, csrf };
}

// enterOnce -- takes up one seat (through the code session-issuing endpoint, no browser needed).
async function enterOnce(request: APIRequestContext, code: string, name: string): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    data: { handle: OWNER.handle, mode: 'code', code, visitor_name: name },
  });
  if (res.status() !== 200) throw new Error(`seat: ${res.status()}`);
}
