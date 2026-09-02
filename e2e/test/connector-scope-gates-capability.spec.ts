// connector-scope-gates-capability.spec.ts — F-B-8 ⭐⭐.
// **The scope that was granted and the capability that gets exposed have never been cross-checked
// against each other.**
//
// The shape this took in prod (2026-08-18): the owner had only granted `calendar.readonly`, and
// the product went right on putting "book a meeting" in front of visitors — listing slots worked
// fine (reads go through), but clicking it 403'd every single time, and the visitor was told "the
// calendar service is temporarily unavailable, try again later." 403-insufficient-scope is
// **permanent** — it will never change no matter how long they wait.
//
// This file guards a discipline **the product already follows elsewhere**: don't offer an action
// you can't perform.
//   · mail can't be sent → the approve button's slot instead reads `connect mail to issue codes`
//     (no button that can't actually be clicked)
//   · mail can't be sent → the entire confirmation-email block on the booking card doesn't
//     render (`ownerCanDeliver`)
// The calendar side is missing exactly this same thing.
//
// **This file has two groups in different states — don't conflate them** (2026-08-20):
//
//   1. The visitor side — **already implemented, already green**: on an instance granted
//      read-only, `calendar_book` / `calendar_cancel` never make it into the session's tool
//      list, while `calendar_list_slots` stays. The mechanism chain is the spec's per-op
//      `security:` → `Spec.ScopesFor` → `openapiCore.CanPerform` (granted ⊇ required) →
//      `Slots.CanPerform` → capreg trimming by tool at assembly time.
//   2. The owner side — **still fixme**: the card that says `connected` doesn't yet have the
//      `connector-scope-shortfall` line ("this grant can't do X, go add Y"). That UI was never
//      built — this isn't a case of the assertion being wrong.
//
// The red state was proven (not just "written and immediately green"): remove `requires` from
// `calendar_book` in the manifest and re-run — the first assertion goes red on the spot, and in
// the correct shape — `calendar_book` reappears in the list, `calendar_list_slots` is still
// there ([[assertion-that-cannot-fail]]).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { sessionToolNames } from '@/fixtures/capabilities';
import {
  ensureDisconnected, expectConnected, fillOAuth2Creds,
  openConnectorCard, resetMockOAuthRecord, selectScope,
} from '@/fixtures/connector-card';
import { GCAL_SCOPE_READ, GCAL_SCOPE_WRITE } from '@/fixtures/gcal';
import { seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed } from '@/fixtures/gcal-setup';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'scopegate@example.com',
  password: 'scope-gate-pass-1',
  handle: 'scopegateowner',
  fullName: 'Scope Gate Owner',
};

const OAUTH2_CONNECTOR_ID = 'google-calendar';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// The owner side: `connected` really means "we're holding a token", but the owner reads it as
// meaning "this connection can do what it's being asked to do" ([[names-that-lie]]) — under a
// read-only grant those two things diverge, and the card used to say not one word about it. That
// line now exists, so this group is no longer fixme.
test.describe('F-B-8 · a read-only grant must not put booking in front of a visitor', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the owner is told the grant cannot book, on the card that claims to be connected',
    async ({ adminPage: page }) => {
      const card = await connectReadOnly(page);
      // `connected` really means "we're holding a token." The owner reads it as meaning "this
      // connection can do what it's being asked to do" ([[names-that-lie]]) — the two diverge
      // exactly here.
      await expect(card.getByTestId('connector-scope-shortfall'),
        'the card names what this grant cannot do, next to the word connected')
        .toBeVisible();
      await expect(card.getByTestId('connector-scope-shortfall'),
        'and it names the scope to add, not just that something is wrong')
        .toContainText(/calendar\.events/);
    });
});

// ── The visitor side: an action you can't do is absent, one you can do is still there ──────────
//
// This group is **not fixme**: the mechanism is already implemented (`3c2333cc`), and on
// 2026-08-20 it was also eyeball-verified in prod — genuinely narrowing the Google grant to
// `calendar.readonly` dropped the product's own log line `agent turn start … tools` from 38 to
// 34, and restoring the grant brought it back to 38. What's guarded here is the same fact, just
// made to run every time.
//
// **Both assertions are required, and the second one is the real point**: asserting only "can't
// book" alone would also pass if the entire booker were hidden — and that would be removing an
// action that **can** be performed in order to fix "offering an action that can't be", which is a
// different defect, not a fix ([[gate-scope-forces-architecture]]).
test.describe('F-B-8 · a read-only grant drops the write tools and keeps the read ones', () => {
  let seed: CodedSeed | undefined;

  test.afterAll(async () => { await teardownSeed(seed); });

  test('booking leaves the visitor session, slot listing stays', async ({ playwright }) => {
    test.setTimeout(120_000);
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { scopes: [GCAL_SCOPE_READ] });
    // Fetch the whole tool list first, then assert on it. `not.toContain` applied directly to a
    // locator passes even before the element has appeared
    // ([[negated-assertion-passes-while-absent]]); what's fetched here is already a concrete
    // array.
    const tools = await sessionToolNames(seed.request, seed.visitor.session_token);

    expect(tools, 'the grant cannot insert an event, so booking is never offered')
      .not.toContain('calendar_book');
    expect(tools, 'nor cancel one')
      .not.toContain('calendar_cancel');
    expect(tools, 'but the grant CAN read free/busy — listing slots must survive')
      .toContain('calendar_list_slots');
  });
});

// connectReadOnly — connects the calendar, granting only the read-only scope. The authorization
// step **genuinely walks through the dance**; following the real provider's convention, the mock
// echoes back the scope actually granted in the token response (a lesson F-C-33 taught it).
async function connectReadOnly(page: Parameters<typeof openConnectorCard>[0]) {
  await resetMockOAuthRecord(page);
  const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await ensureDisconnected(card);
  await fillOAuth2Creds(card, 'scope-gate-client-id', 'mock-client-secret');
  await selectScope(card, GCAL_SCOPE_READ, true);
  await selectScope(card, GCAL_SCOPE_WRITE, false);
  await card.getByTestId('connector-connect-button').click();
  await page.waitForURL('**/admin/connectors**');
  const back = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await expectConnected(back);
  return back;
}
