// connector-op-calendar-check-ui.spec.ts — F-C-16: the calendar card must offer a way to check
// "is it still live right now?"
//
// The mail connector has one (`connectors.mail_test_send`, declared in smtp's manifest); the
// calendar has none at all — and it's precisely the calendar whose failure is **invisible**: the
// OAuth grant can be revoked on Google's side, the refresh token can be rotated out, and the card
// will go on saying "connected" until some stranger tries to book a meeting and it blows up. The
// owner never finds out through the product.
//
// This case only goes through the GUI. A case that drives the API stays green even when the
// panel doesn't exist at all (that's exactly how F-C-12 was found), and what this case guards is
// precisely "can the owner reach this by clicking?"
//
// All three legs assert a **positive** result, not "no error was reported":
//   1. when nothing is connected, the message must say what to do next;
//   2. once connected, the receipt must be **real data** (the busy-block count seeded in the
//      mock), not just the word "ok";
//   3. when the grant is revoked → the message must read as "go reconnect it", not as a raw
//      provider error code.
//      Leg 3 is also the Expected for item check 4, and it's reproducible on the mock — no real
//      Google account needed.
//
// RED (before implementation): the calendar manifest declares no owner op at all → the block
// doesn't exist on the card → the first leg goes red.

import { test, expect } from '@/fixtures/test';

import { revokeMockGCalToken, setMockBusy } from '@/fixtures/gcal';
import {
  OWNER, connectGCalOnExistingOwner, seedOwnerLoggedIn, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

// OP — the operation the calendar declares in its own manifest; strip the `connectors.` prefix
// and what's left is the route segment, and also the testid suffix for that block on the card.
// The category name is hardcoded in **the declaration**, not at this layer.
const OP = 'calendar_check';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let seed: BaseSeed | undefined;

// serial — the first case needs the "calendar not connected yet" state; the two after it connect
// it and then break it. The ordering is part of the test.
test.describe.serial('connectors · the calendar card can answer "is it live?" (F-C-16)', () => {
  // The instance is reset only here — the two cases after this mutate the connector's state
  // within **the same** admin session. seedOwnerGCalConnected calls resetInstance first, which
  // would tear down the session the browser is already logged into.
  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
  });

  test.afterAll(async () => {
    await teardownSeed(seed);
  });

  test('with no calendar connected, the card tells the owner what to do next',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      // Without this block, the owner has only the word "connected" to look at — and that word
      // doesn't check anything at all.
      await expect(op, 'the calendar card must offer a live check').toBeVisible();

      await op.getByTestId('connector-op-run').click();
      await expect(
        op.getByTestId('connector-op-result'),
        'a failure must name the next step, not merely report failure',
      ).toHaveText('no calendar is connected yet — connect one first');
    });

  test('a live check reports what the calendar actually said', async ({ adminPage }) => {
    await connectGCalOnExistingOwner(seed!);
    // Seed two busy blocks. The receipt must count them out — the word "ok" doesn't prove it
    // actually hit the provider, but a correct busy-block count could only have come from there.
    await setMockBusy(seed!.request, [
      { start: '2026-09-01T13:00:00Z', end: '2026-09-01T14:00:00Z' },
      { start: '2026-09-02T15:00:00Z', end: '2026-09-02T16:00:00Z' },
    ]);

    await gotoAdminSection(adminPage, 'connectors');
    const op = adminPage.getByTestId(`connector-op-${OP}`);
    await expect(op).toBeVisible();
    // The window has to cover both blocks above (the default look-ahead may not reach far
    // enough).
    await op.getByTestId('connector-op-field-days').fill('120');
    await op.getByTestId('connector-op-run').click();

    await expect(
      op.getByTestId('connector-op-result'),
      'the receipt must carry data only the provider could have supplied',
    ).toContainText('2 busy blocks');

    // The success message must come from **this operation itself**. The generic layer used to
    // only know the mail phrase "check your inbox to confirm" — which is nonsense for a calendar
    // self-check — and this case guards against that phrase resurfacing.
    expect(
      (await op.getByTestId('connector-op-result').innerText()).toLowerCase(),
      'the generic layer must not narrate a calendar check in mail words',
    ).not.toContain('inbox');
  });

  test('a revoked grant reads as a reconnect, not as a provider error code',
    async ({ adminPage }) => {
      // Connect it again ourselves rather than relying on the state left by the previous case:
      // running this case alone would otherwise turn the message into "calendar not connected
      // yet" — a red, but a red in the setup, which proves nothing about the classification.
      await connectGCalOnExistingOwner(seed!);
      await revokeMockGCalToken(seed!.request);

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-run').click();

      // Item check 4's Expected: a revocation must read as "go reconnect it".
      await expect(
        op.getByTestId('connector-op-result'),
        'a revoked grant must ask for a reconnect in plain words',
      ).toHaveText('the calendar access was revoked — reconnect it to continue');
    });
});
