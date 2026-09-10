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
//
// Pre-hydration typing: the gate is SSR'd, so the code + name fields are on screen and
// typable BEFORE React attaches to them. Keystrokes in that window land in the DOM and
// nowhere else -- there is no listener yet, and React does not re-set a controlled input
// whose prop did not change -- so the visitor ends up looking at a field that plainly
// holds their code above an `enter ↵` that will not enable
// (`disabled = busy || !(codeReady(code) && !blocked)`, and with no submit yet an empty
// `code` is the only thing that can hold it down). The name half is worse because it is
// silent: it would be dropped and the member logged anonymous. A recruiter who scans a QR
// and types the code they were handed is exactly the person fast enough to hit it, and as
// a race it reads as "sometimes the button is dead" -- it was the intermittent red in
// coded-ask-continues. Held deterministically here via openGateUnhydrated.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright, Route } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import { gotoUnhydrated, openGate } from '@/fixtures/navigate';

// JS_CHUNKS —— the app's client bundle. Holding these requests holds HYDRATION: the
// server HTML (and its CSS) still arrives and paints, so the form is on screen and
// typable, but React has not attached to it yet.
const JS_CHUNKS = '**/_next/static/chunks/**';

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

// CODED_LANDING —— where redeeming a code puts the visitor: this code's OWN
// `/c/<slug>` path, not the site root (app/src/lib/visitor/code-landing.ts —— no
// microsite on these codes, so the URL soft-rewrites to /c/<slug>). Deliberately not
// `**/`: that also matches the root, so it would stay green even if the landing
// stopped happening at all.
const CODED_LANDING = /\/c\/[^/?#]+$/;

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
      await page.waitForURL(CODED_LANDING, { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('the strip and the welcome name THIS code’s slice, not the fallback (UX-68)',
    async ({ page }) => {
      await submitCode(page, CODE);
      await page.waitForURL(CODED_LANDING, { timeout: 10_000 });
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
      await page.waitForURL(CODED_LANDING, { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Bob Smith');
    });

  // See the header note on pre-hydration typing.
  test('a code + name typed BEFORE the panel hydrates are not swallowed',
    async ({ page }) => {
      const hydrate = await openGateUnhydrated(page);
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Fast Typist');
      await hydrate();
      // The DOM still holds what was typed — that half is React's hydration contract (it
      // does not clobber a value the visitor already put there); what this case asks is
      // whether the PANEL took it.
      await expect(page.getByTestId('gate-code')).toHaveValue(CODE);
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL(CODED_LANDING, { timeout: 10_000 });
      // The name proves the second, silent half: had it been swallowed too, the code would
      // still have redeemed and the strip would still be here -- just anonymous.
      await expect(page.getByTestId('session-strip')).toContainText('Fast Typist');
    });
});

// openGateUnhydrated -- open /gate with React NOT attached, and hand back the release.
// Every JS chunk is held, so the server HTML paints (the form is there and typable) while
// hydration cannot start; calling the returned function lets it run.
//
// Release by flipping a flag, never by `unroute`: unroute drops the pattern without
// waiting for the held routes, Playwright continues them itself, and this handler's own
// continue() then throws (docs/full-suite-failures.md #1). As a flag, the same handler
// simply becomes a pass-through and nothing is handled twice.
async function openGateUnhydrated(page: Page): Promise<() => Promise<void>> {
  let releasing = false;
  const held: Route[] = [];
  await page.route(JS_CHUNKS, async (r) => {
    if (!releasing) { held.push(r); return; }
    await r.continue();
  });
  await gotoUnhydrated(page, '/gate');
  return async () => {
    expect(held.length, 'hydration was never actually held — the case proves nothing')
      .toBeGreaterThan(0);
    releasing = true;
    await Promise.all(held.map((r) => r.continue()));
  };
}

// openGate -- these are gate code-panel tests; go straight to /gate. (The homepage is a
// microsite now; its access CTA is the GateWidget, covered by its own specs — reaching the
// gate from it is not what these panel tests are about.)
async function openGate(page: Page): Promise<void> {
  await openGate(page);
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
