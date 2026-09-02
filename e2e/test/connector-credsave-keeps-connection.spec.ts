// connector-credsave-keeps-connection.spec.ts -- **the same root cause** as F-C-30 / F-C-34.
//
// Saving credentials once wipes out "connected": the upsert in `owner_connectors.sql.go`
// carries `connected_at = NULL`, while not one byte of the token / credentials changed.
// The panel's Connect button POSTs `/credentials` **first** -- so "connected" is gone
// before authorization has even started. If the flow completes, SaveTokens restores it;
// if it doesn't complete (the owner backs out on the consent page, or just re-saves
// credentials), it stays NULL forever.
//
// Two consequences, both seen in prod:
//   - F-C-30: the badge says `not connected`, while the read-only probe on the same
//     card answers "The calendar answered -- 0 busy blocks". The credentials are alive,
//     the token still refreshes -- **the connection is fine; the label is lying.**
//   - F-C-34: in the same state, clicking test-send gets "no mail connector is set up
//     yet -- connect one first". Because "no active connector" is exactly the condition
//     mapped to "never configured" (`connector/slots.go:260`). The owner is told to do
//     something they just finished doing.
//
// **One field is being used to mean both "where the auth flow got to" and "does this
// connection work", and the two have become impossible to tell apart.** This guard
// asserts the latter: a connection whose **credentials are still there and still work**
// must not turn into "not connected" just because the credentials were saved again.
//
// Driving it via smtp: it has no dance, `connect` is one real handshake, so "save
// credentials once" is the only variable -- the oauth2 path has a redirect mixed in
// that would muddy the isolation.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  configureMailConnector, connectMailOutcome, mailConnectorStatus,
  saveMailCreds, saveMailCredsPartial,
} from '@/fixtures/mail';

// GOOD_PORT -- the port the mock relay is actually listening on (matches SMTP_PORT
// in fixtures/mail.ts). This field needs "value unchanged, just touched", so it must
// be the correct number.
const GOOD_PORT = 1025;

const OWNER = {
  email: 'credsave@example.com',
  password: 'credsave-keeps-conn-1',
  handle: 'credsaveowner',
  fullName: 'Cred Save Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-C-30/34 · saving credentials does not un-connect a working connection', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000); // resetInstance takes ~48s under high load
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('a connected mail connector stays connected when its credentials are saved again',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const before = await mailConnectorStatus(request);
      expect(before.connected, 'setup: the connector is connected to begin with').toBe(true);

      // The owner opens the card and saves the credentials again (not one character
      // changed) -- this is exactly the first thing the panel does when Connect is
      // clicked. In reality "clicked Connect, then changed their mind" is more common,
      // but has the same effect.
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await saveMailCreds(request, csrf);

      const after = await mailConnectorStatus(request);
      expect(after.hasCredentials, 'the credentials are still there').toBe(true);
      expect(
        after.connected,
        'saving the same credentials must not report a working connection as disconnected',
      ).toBe(true);
      await request.dispose();
    });

  // F-C-35 -- the card says, in so many words, "leave the fields blank to keep them".
  // What actually happens is the opposite: **fields you touched stay, fields you
  // didn't get deleted** -- the panel only sends the keys the owner typed into, and the
  // backend replaces `credentials_enc` wholesale. The owner edits one port, and the
  // password is gone -- with no error anywhere along the way.
  //
  // The criterion lands on **whether the connection still works**, not on "the request
  // returned 200": every step of this path returns 200, which is exactly why it's silent.
  test('editing one field keeps the rest of the credentials',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // The owner opens the card and touches only the port field -- its value doesn't
      // even change. The panel sends up just this one key.
      await saveMailCredsPartial(request, csrf, { port: String(GOOD_PORT) });

      // The other six fields must still be there: the connection test is the only
      // thing that can prove that (the credentials themselves are never echoed back).
      const outcome = await connectMailOutcome(request, csrf);
      expect(
        outcome.connected,
        'touching one field must not wipe the credentials the owner never touched',
      ).toBe(true);
      await request.dispose();
    });
});
