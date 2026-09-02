// connector-send-confirmation-tool.spec.ts — §1 (send_confirmation as a tool) + D-4
//
// Today, sending the confirmation email goes through REST. After the refactor it becomes
// a connector-backed **tool**: clicking "use profile / other address / skip" on the
// confirmation widget inside the booked sandboxed card posts
// `{type:'mcp-ui:tool', name:'send_confirmation', args}` -> the host dispatches the
// `send_confirmation` tool with session context -> the tool sends via the mail connector
// proxy -> replies with `mcp-ui:tool-result` -> the card enters sent/error state.
//
// **Recipient enforcement lives in the tool/backend (D-4):**
//   - use profile: sends to **session-email** (the backend reads it from the session; the
//     backend's value wins regardless of what the card passes)
//   - pass-through: sends to the visitor-typed literal address
//   - invalid address: **backend 422** (ParseAddress fails) -> in-card error, zero sends
//     — the sandboxed card cannot route around this
//   - skip: no tool call, no email sent
//
// This spec specifically guards the TOOL path + backend recipient validation
// (complementary to booking-confirmation-email's in-card interaction: that one covers the
// full four-state UX, this one pins down "validation lives in the tool/backend,
// valid -> sent, invalid -> 422 + zero sends").
//
// RED / TDD: fails at runtime until send_confirmation becomes a tool (invoked via
// mcp-ui:tool, recipient validated by the backend).

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

test.describe('connector · send_confirmation as a tool (§1 + D-4 recipient hardening)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    await clearMailpit(seed.request);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('referenced (session-email): send_confirmation tool mails the session email (backend-sourced)',
    ({ browser }) => quoteFlow(browser, seed));
  test('pass-through (typed address): send_confirmation tool mails the typed address',
    ({ browser }) => passthroughFlow(browser, seed));
  test('invalid recipient → backend 422 in the tool, card error, nothing sent',
    ({ browser }) => invalidRecipientFlow(browser, seed));
  test('skip → tool not invoked, no email sent',
    ({ browser }) => skipFlow(browser, seed));
});

// use-profile — session has an email -> click "use profile" -> send_confirmation tool
// sends to **session-email**. The recipient is enforced by reading it from the session on
// the backend, ignoring whatever literal value the card passes.
async function quoteFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Dana', 'dana.session@example.com');
  await bookInChat(page, 14);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-use-profile').click();

  // Clicking should first show "in progress" — this step involves the backend spinning
  // up a sandbox, so it's not instant. There used to be only a "button turns gray" state
  // here, and a visitor couldn't tell whether their click registered when things were
  // slow (see the 30s note below).
  await expect(frame.getByTestId('booking-email-sending')).toBeVisible({ timeout: 10_000 });

  // Observable: the tool, via the mail connector proxy, sent one email to session-email;
  // exactly one send.
  const mail = await waitForMailEnvelopeTo(seed.request, 'dana.session@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  expect(mail.text).toContain(TOPIC);
  // 30s is not a casual relaxation: the most expensive segment in this chain is
  // **capability assembly (spinning up the sandbox)**, roughly 1s when idle, but measured
  // as high as 19s when the machine was saturated during a full-suite run (evidence in
  // test-results-archive's backend.log: the same endpoint, all 200s, dur_ms ranging from
  // 1260 up to 19082). 5s is always enough in isolation, but is guaranteed to fail under
  // full load — an assertion that only goes red under load.
  //
  // **The root cause hasn't been fixed yet** (see task #17: sandbox pre-warming / reuse);
  // relaxing the timeout here is only to keep it from masquerading as a functional
  // failure. The backend side added an alert log for >2s, and the product side added
  // "sending…" — the threshold is the last step, not the first.
  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 30_000 });
  expect(await countMailpitMessages(seed.request)).toBe(1);
  await ctx.close();
}

// pass-through — no session email -> type an address now -> send_confirmation tool sends
// to that literal address.
async function passthroughFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Eli'); // no email filled in
  await bookInChat(page, 15);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-other').fill('eli.typed@example.com');
  await frame.getByTestId('booking-email-send').click();

  const mail = await waitForMailEnvelopeTo(seed.request, 'eli.typed@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 30_000 });
  expect(await countMailpitMessages(seed.request)).toBe(1);
  await ctx.close();
}

// invalid — type junk -> send_confirmation tool/backend ParseAddress fails -> 422 ->
// in-card error, never reaches sent, zero sends. Recipient enforcement lives in the
// tool/backend (D-4); the sandboxed card cannot route around it.
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

  // The backend 422 comes back to the card via tool-result -> error visible
  // (a deterministic signal), never reaches sent, zero sends.
  await expect(frame.getByTestId('booking-email-error')).toBeVisible({ timeout: 5_000 });
  await expect(prompt).toHaveAttribute('data-sent', 'false');
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// skip — clicking skip locks the card purely locally, no tool call, no email sent.
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

  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 30_000 });
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// bookedFrame — the booked sandboxed card iframe; the confirmation widget lives inside it,
// reached via frameLocator.
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

// bookInChat — script a single calendar_book call, trigger it -> wait for the booked
// sandboxed card iframe to appear. `hour` staggers real GCal time slots to avoid mutual
// conflicts (same as #122).
async function bookInChat(page: Page, hour: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
