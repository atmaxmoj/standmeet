// booking-confirmation-email.spec.ts — #122: once a booking is made, the visitor picks on
// the booked card where the confirmation/invite email goes. **Real e2e: browser -> sandboxed
// iframe card -> mcp-ui:tool -> send_confirmation tool -> backend -> owner SMTP (Mailpit)**.
//
// After the refactor (connector deps, §2 + D-4): the confirmation widget is no longer a
// React card + REST, it now lives inside the `mcp-app-card-calendar_book` sandboxed
// iframe; clicking "use profile / other address / skip" makes the card post
// `mcp-ui:tool` -> the host dispatches the `send_confirmation` tool with session context.
// **Recipient enforcement (use session-email / pass a typed address / invalid -> 422 /
// skip) lives inside the tool (backend-validated, 422 is still emitted by the backend)**
// — the sandboxed card only collects + displays, it cannot route around that backend
// gate (#121).
//
// Card contract (the confirmation widget inside the iframe):
//   [data-testid=booking-email-prompt]       — container (appears once booked)
//   [data-testid=booking-email-use-profile]  — "use profile" button (sends to session
//                                                email), rendered only when session has
//                                                an email
//   [data-testid=booking-email-other]        — "other address" text field
//   [data-testid=booking-email-send]         — send to that typed address
//   [data-testid=booking-email-skip]         — "don't send"
//   [data-testid=booking-email-error]        — friendly error shown in-card on backend 422
//
// The recipient can only be the profile's known session email or a visitor-typed address
// — validation lives in the send_confirmation tool/backend, matching #121's recipient
// enforcement.

import { test, expect } from '@/fixtures/test';
import type { Browser, FrameLocator, Page } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo,
  countMailpitMessages, MAIL_FROM,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('booking · send-confirmation email (#122 — deterministic, no AI)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    await clearMailpit(seed.request);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('引用: profile email → "send to my email" → send_confirmation tool mails it (HTML + schema.org)',
    ({ browser }) => quoteFlow(browser, seed));
  test('透传: no profile email → type an address → send_confirmation tool mails it',
    ({ browser }) => passthroughFlow(browser, seed));
  test('透传 非法地址: junk → backend 422, card error, nothing sent',
    ({ browser }) => invalidRecipientFlow(browser, seed));
  test('不发: "don\'t send" → no email goes out',
    ({ browser }) => skipFlow(browser, seed));
});

// use-profile — session has an email -> click "use profile" -> send_confirmation tool
// sends to it; the email carries schema.org markup; exactly one send. The click happens
// inside the iframe -> posts mcp-ui:tool.
async function quoteFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
  await bookInChat(page, 14);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-use-profile').click();

  // Observable side effect = the send_confirmation tool, via the connector proxy, really
  // sent one email to the session email address.
  const mail = await waitForMailEnvelopeTo(seed.request, 'dana.profile@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  expect(mail.text).toContain(TOPIC);
  expect(mail.html).toContain(TOPIC);
  expect(mail.html).toContain('application/ld+json');
  expect(mail.html).toContain('"@type":"EventReservation"');
  expect(mail.html).toContain('"reservationFor"');
  expect(mail.html).toContain('"startDate"');
  // Gmail's EventReservation requires: reservationNumber + location (online -> VirtualLocation).
  expect(mail.html).toContain('"reservationNumber"');
  expect(mail.html).toContain('"@type":"VirtualLocation"');
  // The clickable link in the visible card (the only thing a visitor can click) is
  // present and points at the real GCal event.
  expect(mail.html).toContain('open in google calendar');
  expect(mail.html).toContain('calendar.google.com');

  // The card locks as soon as the tool-result comes back (sent state, actions disappear);
  // the email was already received via waitForMailEnvelope -> count is confirmed at 1.
  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
  await expect(frame.getByTestId('booking-email-use-profile')).toHaveCount(0);
  await expect(frame.getByTestId('booking-email-skip')).toHaveCount(0);
  expect(await countMailpitMessages(seed.request)).toBe(1);
  await ctx.close();
}

// other-address — no session email -> "use profile" doesn't render -> type an address now,
// send_confirmation tool sends it out.
async function passthroughFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Eli'); // no email filled in
  await bookInChat(page, 15);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(frame.getByTestId('booking-email-use-profile')).toHaveCount(0);
  await frame.getByTestId('booking-email-other').fill('eli.typed@example.com');
  await frame.getByTestId('booking-email-send').click();

  const mail = await waitForMailEnvelopeTo(seed.request, 'eli.typed@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  await ctx.close();
}

// invalid-other-address — type junk -> send_confirmation tool/backend ParseAddress fails ->
// 422 -> in-card error (tool-result carries error), never reaches sent, zero sends.
// Recipient enforcement lives in the tool/backend (D-4); the sandboxed card cannot route
// around it.
async function invalidRecipientFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Nads'); // no session email
  await bookInChat(page, 13);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-other').fill('not-an-email');
  await frame.getByTestId('booking-email-send').click();

  // Error visible = the backend 422 came back to the card via tool-result -> never
  // reached sent, nothing was sent. The error being visible is a deterministic signal, no
  // sleep needed.
  await expect(frame.getByTestId('booking-email-error')).toBeVisible({ timeout: 5_000 });
  await expect(prompt).toHaveAttribute('data-sent', 'false');
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// skip — clicking skip locks the card purely locally, no tool call / no email sent.
// data-sent=true means it's final, and there's zero emails at this point.
async function skipFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Mara', 'mara@example.com');
  await bookInChat(page, 16);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-skip').click();

  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// owner has no mail connector configured -> the whole confirmation widget doesn't render
// (the owner literally can't send email). After the refactor this is backstopped by the
// connector dependency gate: send_confirmation's booker capability Requires smtp, and the
// confirmation widget doesn't enter the card when unconnected — the booked card still
// shows as booked as usual, but there's no email-prompt inside the iframe.
test.describe('booking · no mail connector → no confirmation card (#122)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    // Note: configureMailConnector is deliberately not called — the owner has no
    // send-mail capability.
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('booked, but owner can\'t email → booking-email-prompt is not rendered',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 17);

      // The booked card still shows as booked as usual, but there's no confirmation-email
      // section inside the iframe.
      const frame = bookedFrame(page);
      await expect(frame.getByTestId('book-card-time')).toBeVisible();
      await expect(frame.getByTestId('booking-email-prompt')).toHaveCount(0);
      await ctx.close();
    });
});

// bookedFrame — the externalized booked card is a sandboxed iframe; its content
// (time + confirmation widget) is reached via frameLocator.
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterWithProfile — ?code entry -> fill name (and optionally email) in the name picker
// -> submit -> wait for the session.
async function enterWithProfile(
  page: Page, code: string, name: string, email?: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  if (email !== undefined) await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;
}

// bookInChat — script a single calendar_book call, send one chat message to trigger it ->
// wait for the booked sandboxed card iframe to appear. `hour` puts each test into a
// **different real GCal time slot**: under the same owner calendar, if every test booked
// the same time, a later booking would collide with an earlier one (slot already busy)
// -> no confirmation card would appear. Fixed at +7 days (a known weekday), only the hour
// varies (all within working hours, never overlapping within 30 minutes), which avoids
// both conflicts and weekend/policy pitfalls.
async function bookInChat(page: Page, hour: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  // The booked card is now a sandboxed iframe (mcp-app-card-calendar_book), not a React
  // card in the main DOM.
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
