// connector-connect-before-form.spec.ts — **Connect must not be pressable while the
// card still doesn't know which kind of connection it is.**
//
// ①🔴 Full-suite finding #436 goes red right here (connector-happy-matrix, openapi
// calendar + oauth2). The card in the artifact: the scheme says `oauth2`, the CLIENT
// ID / CLIENT SECRET fields are both empty, and a red line at the bottom reads
// "The connection test failed." — a message that **only belongs to the non-dance
// path** (the fallback copy for `runNonDanceConnect`). An oauth2 connector had gone
// through the bearer/apiKey branch instead.
//
// ②🎯 `useConnectorCard.connect()` branches on `authType`, and `authType` only gets a
// value once `/{id}/credential-form` returns — before that it's an empty string,
// which falls into the "non-dance" branch. But the Connect button is live from the
// **very first frame**: the moment the card mounts (the fastest possible case, right
// after assembly hands the form off to the card), so whoever presses first takes the
// wrong branch. These two events happen right next to each other on the assembly
// path, which is why that e2e goes red now and then; an owner clicking manually can
// hit the same thing, they just never see which branch ran — what they see is
// "can't connect".
//
// ③🧪 This spec makes that frame deterministic: it holds back the credential-form's
// **response** (the request really goes out, the answer is in hand, the browser just
// hasn't received it yet) — the card at that moment looks exactly like that frame.
// How long it's held back is controlled by the test releasing it, not by a timer —
// a timer would be racing against machine speed, and the losing run would look
// identical to a pass.
//
// The criterion has two layers: the button must not be pressable during that frame
// (structurally impossible to mis-click), and once released, oauth2 must actually go
// through the dance.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { openConnectorCard, fillOAuth2Creds, expectConnected } from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'connect-form@example.com', password: 'correct-horse-battery-staple',
  handle: 'connectform', fullName: 'Connect Form Owner',
};

// The built-in oauth2 connector (calendar kind, runs the dance). oauth2 is chosen
// because it's **the only one** where taking the wrong branch turns into a visible
// error outcome: the non-dance branch can never connect an oauth2 connector.
const OAUTH2_CONNECTOR_ID = 'google-calendar';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector card · the frame before its form arrives', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('Connect is dead while credential-form is in flight; oauth2 then dances',
    async ({ adminPage: page }) => {
      const marks = { fetched: [] as number[], delivered: [] as number[] };
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => { release = resolve; });
      // **Let the request actually go out first, then hold back the response.**
      // Holding it before continue() would just delay the whole request, and then the
      // card would never render the "form unknown" frame at all — that would be
      // testing a different path.
      await page.route('**/credential-form*', async (route) => {
        const res = await route.fetch();
        const body = await res.body();
        marks.fetched.push(Date.now());
        await held;
        await route.fulfill({ response: res, body });
        marks.delivered.push(Date.now());
      });

      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      const connect = card.getByTestId('connector-connect-button');
      await expect(connect, 'the card is on screen').toBeVisible();
      // Self-proving: the form really is still in flight at this point. What's waited
      // on is fetched (the answer is already in hand, held back), not "entered the
      // handler" — the latter lands before `route.fetch()` resolves, and the window
      // hasn't opened yet at that point.
      await expect.poll(() => marks.fetched.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(marks.delivered.length, 'the form has not reached the browser yet').toBe(0);
      await expect(
        connect,
        'while the card cannot know which branch to take, Connect must not be pressable',
      ).toBeDisabled();
      expect(marks.delivered.length, 'the window was still open during that check').toBe(0);
      release();
      // Once the window has served its purpose, tear down the route. The dance is a
      // **full-page navigation**, and it discards the response still sitting in the
      // handler — the handler then blows up on `res.body()` ("Response has been
      // disposed"), for a reason that has nothing to do with what's actually under
      // test. The interception should only be alive for the frame it exists to create.
      //
      // Wait for that response to actually be sent before tearing down: `unroute`
      // would **take over on the spot** any route that hasn't landed yet, so my own
      // fulfill would hit "Route is already handled" — releasing and tearing down are
      // two separate steps, and doing them out of order is the same as never
      // releasing at all.
      await expect.poll(() => marks.delivered.length, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.unroute('**/credential-form*');

      // After release, it connects normally: the button comes alive, oauth2 goes
      // through the dance (full-page navigation to the consent page and back), and
      // the card turns connected. "Cannot be pressed" must never come at the cost of
      // the feature itself.
      await expect(connect).toBeEnabled({ timeout: 15_000 });
      await fillOAuth2Creds(card, 'mock-client-id', 'mock-client-secret');
      await connect.click();
      await page.waitForURL('**/admin/connectors**');
      await expectConnected(card);
    });
});
