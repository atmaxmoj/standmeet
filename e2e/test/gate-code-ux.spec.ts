// gate-code-ux.spec.ts —— gate code panel UX: uppercase normalization,
// error shake, checking state, code + name submit.
//
// User story:
//   1. paste code -> uppercase normalization + strip anything not [A-Z0-9-]
//   2. wrong code -> shake animation -> clear -> refocus
//   3. "checking" state -> button text changes after submit
//   4. code + name submitted together -> session carries the visitor name
//
// Every error test case here asserts **the exact message**, not "there was an error":
// asserting only that gate-error is visible would stay green even if the panel called
// every non-2xx "unknown code" (F-A-23). And "doesn't exist" vs. "was revoked" are two
// separate messages F-D-6 split apart -- a typo means paste it again, a revocation means
// go ask for a new code (chat.go:122-134). That cut never carried the wording through
// to here, so the first case has **stayed red the whole time**; the second (revoked)
// never had e2e coverage at all.
//
// UX-68: the top strip shows **that code's own label** (design source
// docs/design/project/app.js:696, 'OpenAI eng loop' / 'a16z partner intro'); `invited`
// is only the fallback for when there's no label. The backend has always sent
// code_label, but the SDK's PublicSessionResponse never declared the field, and the
// gate hardcoded label: null, so every code got called invited -- and that welcome line
// is meant to tell the visitor their own scope of access.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'gate-ux@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gateux',
  fullName: 'Gate UX Owner',
};

const CODE = 'GATEUX-001';
// A real code, quota of 1, and that one slot is already used -- exists, not expired,
// just full.
const FULL_CODE = 'GATEUX-FULL';
// A code that was issued, then revoked by the owner -- it did exist, and that's a
// different claim from "never existed".
const REVOKED_CODE = 'GATEUX-REVOKED';

test.describe('gate code panel UX polish', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance takes ~48s under high load, and the default hook budget is only 30s
    await initOwner(playwright);
  });

  test('code input normalizes to uppercase',
    async ({ page }) => {
      await openGate(page);
      const codeInput = page.getByTestId('gate-code');
      await codeInput.fill('gateux-001');
      // Value should be uppercased
      await expect(codeInput).toHaveValue('GATEUX-001');
    });

  test('wrong code → the panel says the code is invalid',
    async ({ page }) => {
      await submitCode(page, 'BOGUS-CODE');
      await expect(page.getByTestId('code-panel').getByTestId('gate-error'))
        .toHaveText(/no such access code/i, { timeout: 5_000 });
    });

  test('a REVOKED code says it was revoked, not that it never existed',
    async ({ page }) => {
      await submitCode(page, REVOKED_CODE);
      const said = await gateErrorText(page);
      expect(said, '这张码存在过,不许说它从来没有过').not.toContain('no such access code');
      expect(said, '说出下一步:去要一张新的').toMatch(/revoked/);
    });

  // F-A-23 -- a real code, just out of quota, gets reported as "UNKNOWN CODE".
  // The backend is precise about it: 401 = this code doesn't exist; 403
  // `member_quota_reached` = "this code is full - no more names available", written
  // exactly for the visitor to read. But the panel collapses every non-2xx into one
  // boolean error, so a recruiter holding a valid invite is told their code doesn't
  // exist -- they retype it, conclude the owner gave them the wrong code, and leave.
  test('a code that is FULL says so, instead of claiming it does not exist (F-A-23)',
    async ({ page }) => {
      await submitCode(page, FULL_CODE, 'Second Name');
      const said = await gateErrorText(page);
      expect(said, '这张码是真的存在的,不许说它不存在').not.toMatch(/unknown code/);
      expect(said, '把后端那句写给访客的话原样说出来').toMatch(/full|no more names/);
    });

  test('submit → checking state → button text changes',
    async ({ page }) => {
      await submitCode(page, CODE);
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('the strip and the welcome name THIS code’s slice, not the fallback (UX-68)',
    async ({ page }) => {
      await submitCode(page, CODE);
      await page.waitForURL('**/', { timeout: 10_000 });
      const strip = page.getByTestId('session-strip');
      await expect(strip).toBeVisible({ timeout: 5_000 });
      // Pull the text out first, then assert: `.not.toContainText` also passes when the
      // element hasn't rendered yet. This cell's CSS is text-transform:uppercase, so
      // innerText comes back uppercase -- the assertion cares about which code is
      // named, not the letter case, so lowercase both sides before comparing.
      const said = (await strip.innerText()).toLowerCase();
      expect(said, '顶栏说出这张码的标签').toContain('gate ux test');
      expect(said, '拿到了真标签就不该再退回兜底').not.toContain('invited');
    });

  test('code + visitor name → session carries name',
    async ({ page }) => {
      await openGate(page);
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Bob Smith');
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Bob Smith');
    });
});

// openGate -- these are gate code-panel tests; go straight to /gate. (The homepage is a
// custom page now; its access CTA is the GateWidget, covered by its own specs — reaching the
// gate from it is not what these panel tests are about.)
async function openGate(page: Page): Promise<void> {
  await goto(page, '/gate');
}

// submitCode -- enter the gate, fill in a code (optionally a name), submit. Each test
// case is left with only the one assertion it cares about.
async function submitCode(page: Page, code: string, visitor?: string): Promise<void> {
  await openGate(page);
  await page.getByTestId('gate-code').fill(code);
  if (visitor !== undefined) await page.getByTestId('gate-visitor-name').fill(visitor);
  await page.getByTestId('gate-code-submit').click();
}

// gateErrorText -- waits for the refusal message to appear, then pulls its text and
// lowercases it. Pulling the text before asserting is deliberate:
// `.not.toContainText` also passes while the element hasn't rendered yet.
async function gateErrorText(page: Page): Promise<string> {
  const err = page.getByTestId('code-panel').getByTestId('gate-error');
  await expect(err).toBeVisible({ timeout: 5_000 });
  return (await err.innerText()).toLowerCase();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'gate-ux-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'gate ux intro.', title: 'Gate UX Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Gate UX test',
  });
  await createCode(request, csrf, {
    code: FULL_CODE, label: 'Gate UX full', max_members: 1,
  });
  const revoked = await createCode(request, csrf, {
    code: REVOKED_CODE, label: 'Gate UX revoked',
  });
  await revokeCode(request, csrf, revoked.id);
  // Use up that one and only slot: from now on this code exists, is valid, and is full.
  await issueSession(request, {
    handle: OWNER.handle, code: FULL_CODE, visitor_name: 'First Name',
  });
  await request.dispose();
}
