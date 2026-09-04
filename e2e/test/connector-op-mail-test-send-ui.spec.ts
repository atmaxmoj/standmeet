// connector-op-mail-test-send-ui.spec.ts —— F-C-12: a connector's **own declared owner op** must have a face on the card.
//
// why this guard exists, rather than yet another endpoint-hitting test: `connectors.mail_test_send` has long worked ——
// declared in smtp's manifest, implemented in axisconn/impls.go, routed at /connectors/ops/mail_test_send,
// and on failure it already classifies and gives three sentences of plain words. **But admin has no control that can trigger it**
// (`grep -rn mail_test_send app/src` returns nothing).
//
// five existing tests touch this op (connector-happy-matrix / connector-openapi-mail /
// connector-provider-agnostic / owner-mcp-parity-connectors / norm-outward-toolset),
// each one a `request.post(.../ops/…)` or an MCP callTool ——**not one goes through the browser**.
// a suite that only drives the capability, not the face, stays all green even when the face doesn't exist at all. So this one goes only through the GUI:
// click the button the owner can click, read the sentence the owner can read.
//
// both legs assert the **positive** outcome: one asserts the "what's next" sentence when not connected, one asserts Mailpit really received it after a successful send
// ——the "sent" on the UI is what the client says, the mail in the inbox is the receipt.
//
// F-C-34 —— failure classification has three branches, and all three are guarded here: no connector / relay rejects / **unreachable**.
// the third branch was added while driving prod: that time the owner mistyped the port, Connect gave a good sentence, and right after test-send said
// "you haven't configured a mail connector yet". **This guard can't reproduce that cell** —— while the connector is still in the active slot, the product
// says the correct sentence. The difference on prod was that the failed Connect **kicked it out of the active slot**, and "no active"
// is exactly the condition that maps to "not configured yet" (`connector/slots.go:260`). Producing that state is F-C-30's job,
// the two share one root. What's left here is the regression guard for "the unreachable branch is alive".

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  armSMTPFault, clearMailpit, configureMailConnector, connectMailOutcome,
  resetSMTPFault, saveMailCreds, saveMailCredsPartial, waitForMailEnvelopeTo,
} from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'opface@example.com', password: 'test-password-1234',
  handle: 'opface', fullName: 'Op Face',
};

// OP —— the op smtp declares in its own manifest; strip the `connectors.` prefix and it's the route segment,
// and also the testid suffix of that block on the card. What hardcodes the category name is the **declaration**, not this layer.
const OP = 'mail_test_send';

// DEAD_PORT —— a number nobody listens on, on the mock relay's host. What we want is the "reaches the host, can't reach the service"
// kind of real failure, not a DNS lookup miss (that's another class).
// 2525 was tried first —— but mail-mock happens to listen there too, so connect returned 200 and the red landed on the
// assembly assertion rather than the product ([[red-in-the-wrong-place]]). 9 is the discard port, nobody opens it.
const DEAD_PORT = 9;

// BLACKHOLE_HOST —— an unroutable address: dialing it isn't refused, it just hangs until TCP itself gives up.
// "refused" and "dropped into the void" are the same thing to the owner (both unreachable), but to **time** they aren't at all.
const BLACKHOLE_HOST = '10.255.255.1';

// OUTBOUND_ANSWER_BUDGET_MS —— how long the owner is still willing to stare at the screen. On prod that was 75 seconds,
// by which the browser had long since timed out and changed its story to "can't reach your instance", and the top bar flipped to NOT ANSWERING.
const OUTBOUND_ANSWER_BUDGET_MS = 20_000;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// serial —— the first test wants the "no mail connector yet" state, the second connects it. The order is part of the tests.
test.describe.serial('connectors · a declared owner op has a face on the card (F-C-12)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('with no mail connector, the card tells the owner what to do next', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'connectors');
    const op = adminPage.getByTestId(`connector-op-${OP}`);
    // the mail card must offer a "send a test mail" action —— without it the owner has no way to know whether mail works.
    await expect(op, 'the mail card must offer a test-send').toBeVisible();

    await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
    await op.getByTestId('connector-op-run').click();

    // the sentence the backend's mailFailureReason produces after classifying, rendered onto the face as-is. Assert the whole sentence: its value is in the wording
    // ("what to do next"), not in "whether there's a reason field".
    await expect(
      op.getByTestId('connector-op-result'),
      'a failure must name the next step, not merely report failure',
    ).toHaveText('no mail connector is set up yet — connect one first');
  });

  test('a test-send from the card really leaves the building', async ({ adminPage, playwright }) => {
    const request = await playwright.request.newContext();
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await clearMailpit(request);

    await gotoAdminSection(adminPage, 'connectors');
    const op = adminPage.getByTestId(`connector-op-${OP}`);
    await expect(op).toBeVisible();

    const to = 'op-face-receipt@standmeet.test';
    await op.getByTestId('connector-op-field-to').fill(to);
    await op.getByTestId('connector-op-run').click();

    // the success sentence must state **which kind** of mail connector delivered it (item check 6: "The success path says
    // which kind delivered it") —— smtp is a protocol kind.
    const result = op.getByTestId('connector-op-result');
    await expect(result, 'a success must name the connector kind that served it')
      .toContainText('protocol');

    // the wording must not overreach what an SMTP submission can guarantee: 250 means "accepted", not "delivered". A real relay
    // (Gmail) will accept a non-existent domain and then bounce it asynchronously, so saying delivered here guarantees something it
    // doesn't know. This asserts the **absence** of that word —— take the text first, then judge; don't use not.toContainText:
    // that assertion also passes while the element hasn't appeared yet.
    expect(
      (await result.innerText()).toLowerCase(),
      'a 250 proves the relay accepted it, never that it was delivered',
    ).not.toContain('delivered');

    // the receipt is in the inbox, not next to the button.
    const envelope = await waitForMailEnvelopeTo(request, to);
    expect(envelope.to, 'Mailpit received the test mail — the receipt, not the UI sentence')
      .toContain(to);
    await request.dispose();
  });

  // a relay permanently rejecting (5xx) and it being temporarily unavailable are two things to the owner: the former means change the recipient, the latter means wait a bit.
  // the SMTP path used to lump both into "temporarily unavailable", so the "change the recipient" sentence **never came out** ——
  // a branch that can never appear is the same as not written. This drives it from the card.
  test('a relay that rejects the message says to change the recipient, not to wait',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      // configure the mail connector ourselves, not relying on the state left by the previous test: running this one alone would turn that sentence into
      // "no mail connector yet" —— a red, but a red on assembly, proving nothing about classification.
      await configureMailConnector(request, OWNER.email, OWNER.password);
      await armSMTPFault(request, { mode: 'permanent', times: 1 });

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
      await op.getByTestId('connector-op-run').click();

      // a 5xx must point at the recipient, not say "try again later" —— a hundred retries won't help.
      await expect(
        op.getByTestId('connector-op-result'),
        'a 5xx must point at the recipient, not tell the owner to wait',
      ).toHaveText('the mail provider rejected this message — check the recipient address');

      await resetSMTPFault(request);
      await request.dispose();
    });

});

// the third failure: the connector **is** there (configured, connected, occupying the category slot), but unreachable. See the F-C-34 paragraph in the file header.
// a separate describe: it shares the file-level ownerCredentials and the already-claimed instance with the group above,
// but configures its own connector and makes its own failures, not relying on the state left above.
// this group waits on real dial failures, one of them the "hangs" kind (an unroutable address). The budget goes on the
// describe rather than in the test body: the time the fixture takes to build adminPage **also counts** against the test timeout, while the body's
// `test.setTimeout` hasn't run yet at that point —— the red would land on assembly and look like a slow test.
test.describe.configure({ timeout: 150_000 });

test.describe('connectors · a configured-but-unreachable relay names its own class (F-C-34)', () => {
  // claim ourselves, **not piggybacking on the group above's beforeAll**. Piggybacking means that running this group alone (`GREP=`) leaves the instance
  // unclaimed, adminPage can't log in → a 30-second timeout, and the red looks like "the product didn't answer in time".
  // this tripped me once: the screenshot plainly said `invalid credentials`, yet I went guessing the dial had hung the page first.
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('it says it could not reach the provider, not that none was ever set up',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      // configure, connect, occupy the category slot first —— this cell wants "configured", not "not configured".
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      // then change the port to the one nobody listens on and reconnect (which fails) —— the shape of the owner mistyping one character.
      await saveMailCreds(request, csrf, { port: String(DEAD_PORT) });
      // read the **receipt**, not the HTTP status: this endpoint still returns 200 when it can't connect, writing the result in the body.
      const outcome = await connectMailOutcome(request, csrf);
      expect(outcome.connected, 'connecting to a dead port must not report connected').toBe(false);

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
      await op.getByTestId('connector-op-run').click();

      // assert the **positive**: this class should say "unreachable, try later". Asserting "not equal to the not-configured sentence"
      // would let through any fourth wording, and this cell's value is that it names the right class.
      await expect(
        op.getByTestId('connector-op-result'),
        'a configured-but-unreachable relay must not be reported as "never set up"',
      ).toHaveText("couldn't reach the mail provider — please try again later");

      await request.dispose();
    });

  // F-C-36 —— there are two ways to fail to connect: **refused** (connection refused comes back immediately) and **dropped into the void** (the packet is discarded,
  // waiting until TCP itself times out). The mock relay always gives the former, so "slow" doesn't exist in front of it;
  // on prod, mistyping the port is the latter, and the backend waited **75 seconds** before answering.
  //
  // the consequence of those 75 seconds isn't "a bit slow": the browser had long since timed out, the screen showed the client's own
  // "Couldn't reach your instance", the top-bar health light flipped to NOT ANSWERING —— all three sentences false,
  // while the backend had in fact **already said the right thing** ("temporarily unavailable"), only nobody was still watching.
  //
  // the check is therefore **correct wording within a time limit**: the owner must get the right sentence within the time they're still willing to wait.
  // the black-hole address uses the unroutable 10.255.255.1 —— dialing it from a container isn't refused, it just hangs, the same shape as the real incident.
  test('an outbound dial that hangs still answers the owner in time',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await saveMailCredsPartial(request, csrf, { host: BLACKHOLE_HOST });

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
      await op.getByTestId('connector-op-run').click();

      await expect(
        op.getByTestId('connector-op-result'),
        'a hung dial must come back with the real reason while the owner is still watching',
      ).toHaveText("couldn't reach the mail provider — please try again later",
        { timeout: OUTBOUND_ANSWER_BUDGET_MS });
      await request.dispose();
    });

  // F-C-37 —— the server **answered**, and answered fast and clearly (`400 to is required`, 33ms). Yet the screen said
  // "Couldn't reach your instance — check your connection and retry", pushing the owner to check the network,
  // when all they had to do was fill an address into that box.
  //
  // the three states were designed correctly ("didn't go through / ran but didn't succeed / succeeded"), but collapsed at the one place that judges:
  // `use-connector-op.ts`'s `.catch(() => ({ reached: false }))` —— any rejection counts as didn't-go-through,
  // including a 400 carrying an intact envelope.
  test('a request the server answered names its reason, not the network',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      // run with the recipient **left empty** —— the easiest action the owner can take.
      await op.getByTestId('connector-op-run').click();

      // assert the sentence in the envelope ("to is required"). Asserting "not equal to the unreachable sentence" would let through any third
      // wording, and this cell's value is that it states the **reason the server gave**.
      await expect(
        op.getByTestId('connector-op-result'),
        'the server said what was wrong; the screen must say that, not blame the connection',
      ).toContainText(/required/i);
      await request.dispose();
    });
});
