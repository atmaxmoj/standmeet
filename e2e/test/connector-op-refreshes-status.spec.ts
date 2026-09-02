// connector-op-refreshes-status.spec.ts —— F-C-45: **a card must not say two contradictory
// things at once.**
//
// On 2026-08-20, on prod, an authorization was actually revoked on the Google account page,
// then the probe on the card was clicked on return. The backend got it right: the probe
// answered *"the calendar access was revoked — reconnect it to continue"*, the DB
// immediately went to `active=f`, `connected_at=NULL`, one WARN in the logs, zero retries.
// **But the top-right corner of that same card still said `connected`** — right above that
// sentence — and only caught up after a refresh.
//
// This is exactly what this module's first LOOK item exists to prevent: *"The card shows its
// true state … never a stale default from before the last action."* What the owner reads is
// a self-contradictory screen, where one of the two statements is false.
//
// The fix **does not branch by error category**: the connection state's home is the backend,
// and the card just **asks again after the action**. Making each op individually remember
// "this class of failure needs to notify the card" means the next op will forget
// ([[structure-means-no-responsibility-class]]).
//
// Two assertions, both required:
//   1. the probe's sentence is still there (the revocation message was correct to begin
//      with — don't let the fix accidentally remove it too);
//   2. the status has become not connected **on the same screen** — no reload allowed. A
//      reload would obviously make it correct, and the owner won't refresh the product for it.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { openConnectorCard, expectConnected } from '@/fixtures/connector-card';
import { revokeMockGCalToken } from '@/fixtures/gcal';
import { connectGCalOnExistingOwner, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const DB_CONTAINER = 'standmeet-dev-db-1';

const OWNER = {
  email: 'revokecard@example.com',
  password: 'revoke-card-pass-1',
  handle: 'revokecardowner',
  fullName: 'Revoke Card Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-C-45 · an op that finds the grant revoked updates the card it sits on', () => {
  let seed: BaseSeed | undefined;

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    seed = { request, csrf };
    await connectGCalOnExistingOwner(seed);
  });

  test.afterAll(async () => { await teardownSeed(seed); });

  test('the probe says revoked, and the status beside it stops saying connected',
    async ({ adminPage: page }) => {
      test.setTimeout(120_000);
      const card = await openConnectorCard(page, 'google-calendar');
      await expectConnected(card);

      // The revocation happens somewhere the owner can't see (on the provider's side), so
      // nothing on the card changes — until the next time it's actually used. This is that moment.
      await revokeMockGCalToken(page.request);
      expireAccessToken();

      await card.getByTestId('connector-op-field-days').fill('3');
      await card.getByTestId('connector-op-run').click();

      await expect(card.getByTestId('connector-op-result'),
        'the probe still says what happened, in words the owner can act on')
        .toContainText(/revoked/i, { timeout: 30_000 });

      await expect(card.getByTestId('connector-status'),
        'and the card no longer claims to be connected — on this screen, without a reload')
        .toHaveText(/^(not connected|未连接)$/i, { timeout: 15_000 });
    });
});

// expireAccessToken —— pushes the access token into expiry, so the next call that uses the
// calendar has to refresh it — and that refresh is exactly the step that hits invalid_grant.
// Uses the same knob as chat-book-token-refresh.
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  );
}
