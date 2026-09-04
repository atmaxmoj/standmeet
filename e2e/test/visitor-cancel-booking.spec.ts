// visitor-cancel-booking.spec.ts —— #123: a visitor cancels a meeting, **only one they booked themselves**.
//
// After the refactor (connector deps, §2): cancel no longer goes through "React card + REST postBookingCancellation",
// but lands inside the `mcp-app-card-calendar_book` sandbox iframe —— the card's cancel button posts
// `mcp-ui:tool` → host dispatches the `calendar_cancel` tool with **session context** → the tool deletes the
// event + returns `mcp-ui:tool-result` → the card goes to cancelled state. The whole click path moves into the iframe;
// but the **isolation semantics don't change**: the authorization gate is still "allow only when the booking's
// conversation satisfies owner+code+member all equal to this session" —— otherwise the tool returns booking_not_found, **deletes no event**.
//
// Isolation is the point of this spec. A booking's ownership chain: booking → conversation → member. The visitor
// session carries owner_id + code_id + member_id. The `calendar_cancel` tool's authorization gate: find the booking by
// event_id, but allow **only when** that booking's conversation satisfies owner+code+member
// all equal to the session making the tool call, otherwise return a booking_not_found tool-error. This one gate blocks both:
//   - same code, cross member (Mallory wants to cancel Dana's meeting)
//   - cross owner / cross code
//
// The happy path is fully browser-driven (book → enter the iframe card → click cancel → tool runs → event deleted).
// The two isolation negative cases' "attack" is essentially a forged tool call —— it's sent from the **attacker's own
// authenticated session** (the real attack surface), asserting that `calendar_cancel`'s session gate blocks it (cancel doesn't
// succeed) and the victim's GCal event remains. The tool goes through a connector-backed proxy, but the recipient/ownership check is in the tool/backend; the sandbox card can't bypass it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, FrameLocator, Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const TOPIC = 'Intro call about backend work';

test.describe('visitor · cancel own booking + isolation (#123)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('happy: visitor books, clicks cancel inside the card iframe → GCal event removed',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // The name must be unique across sub-tests: a member is looked up by (code_id, name) (GetOrCreateMember),
      // so the same name + same code resumes the same open chat, and the previous sub-test's booking card leaks in →
      // the next sub-test's calendar_book locator hits multiple cards and blows up in strict mode. Each uses an isolated visitor.
      await enterAndBook(page, seed.code.code, 'Hana', 'hana@example.com', 14);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      // Cancel lands inside the sandbox iframe: the card's cancel button posts mcp-ui:tool → calendar_cancel.
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      // The card drops to cancelled state (action disappears, marked cancelled). The state is on the card inside the iframe.
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(frame.getByTestId('book-card-cancel')).toHaveCount(0);

      // Real delete: the tool deleted that mock GCal event via the connector proxy (observable side effect = the tool actually ran).
      const after = await getMockEvents(seed.request);
      expect(after.find((e) => e.event_id === eventID)).toBeUndefined();
      await ctx.close();
    });

  test('nonexistent event_id on a valid session → not cancelled, no crash',
    async () => {
      // Valid session, but this conversation has no booking (or the event_id doesn't match) → a booking_not_found
      // tool-error, cancel doesn't succeed and deletes nothing.
      const cancelled = await attemptCancel(
        seed.request, seed.visitor, 'evt-does-not-exist');
      expect(cancelled, 'no booking to cancel → not cancelled').toBe(false);
    });

  test('isolation (same code, other member): Mallory cannot cancel Dana\'s booking — but Dana can',
    ({ browser }) => crossMemberIsolation(browser, seed));

  // On a single-owner instance we can't really create two owners for cross-owner (resetInstance clears and re-claims the same person),
  // so the owner-dimension isolation is instead covered by **cross code** (same owner, another access code), covering the code_id dimension.
  test('isolation (other code, same owner): a code-2 visitor cannot cancel a code-1 booking',
    ({ browser }) => crossCodeIsolation(browser, seed));
});

// crossMemberIsolation —— Dana (member A) books, Mallory (same code, member B) can't cancel it (404),
// the victim event remains; but Dana herself can click cancel on her own iframe card.
async function crossMemberIsolation(browser: Browser, seed: CodedSeed): Promise<void> {
  await resetMockGCal(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterAndBook(page, seed.code.code, 'Dana', 'dana@example.com', 15);
  const victimEvent = (await getMockEvents(seed.request))[0]!.event_id;

  // Attacker Mallory: another member under the same code. Session is valid, but the member differs.
  // Attack surface = forge a calendar_cancel tool call from Mallory's own session (the sandbox card's mcp-ui:tool
  // landing on the backend is this tool-dispatch request); the ownership gate is in the tool/backend, blocks it → 404.
  const mallory = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code,
    visitor_name: 'Mallory', visitor_email: 'mallory@example.com',
  });
  expect(await attemptCancel(seed.request, mallory, victimEvent),
    'Mallory cannot cancel Dana\'s booking').toBe(false);
  expect((await getMockEvents(seed.request)).find((e) => e.event_id === victimEvent))
    .toBeDefined(); // the victim's event wasn't wrongly deleted

  // Positive case (same member): Mallory can't cancel this one, but Dana herself can click cancel on the iframe card.
  const frame = bookedFrame(page);
  await frame.getByTestId('book-card-cancel').click();
  await expect(frame.getByTestId('tool-card-calendar_book'))
    .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
  expect((await getMockEvents(seed.request)).find((e) => e.event_id === victimEvent))
    .toBeUndefined();
  await ctx.close();
}

// crossCodeIsolation —— a valid visitor on another code of the same owner can't cancel a code-1 booking.
async function crossCodeIsolation(browser: Browser, seed: CodedSeed): Promise<void> {
  await resetMockGCal(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Unique name isolates the sub-test (see the happy test comment: same name + same code resumes the same chat).
  await enterAndBook(page, seed.code.code, 'Cody', 'cody@example.com', 16);
  const victimEvent = (await getMockEvents(seed.request))[0]!.event_id;

  const code2 = await issueCodeWithSkills(seed.request, seed.csrf, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  const intruder = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code2.code,
    visitor_name: 'Ivan', visitor_email: 'ivan@example.com',
  });

  const cancelled = await attemptCancel(seed.request, intruder, victimEvent);
  expect(cancelled, 'code-2 visitor cannot cancel a code-1 booking').toBe(false);

  expect((await getMockEvents(seed.request)).find((e) => e.event_id === victimEvent))
    .toBeDefined(); // the victim's event remains
  await ctx.close();
}

// bookedFrame —— the externalized booked card is a sandbox iframe; its content is reached via frameLocator.
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterAndBook —— ?code entry → fill name (+email) → script one calendar_book → trigger →
// wait for the booked sandbox-card iframe to appear. The hour is staggered from real GCal slots to avoid conflicts (same as #122).
async function enterAndBook(
  page: Page, code: string, name: string, email: string, hour: number,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;

  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  // The booked card is now a sandbox iframe (mcp-app-card-calendar_book), not a React card in the main DOM.
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

// attemptCancel —— forge a calendar_cancel tool call from the attacker's **own authenticated session**
// (the real attack surface). It goes through the same tool-dispatch route the card's mcp-ui:tool dispatch lands on
// (`POST /api/v1/sessions/{conv}/tools/calendar_cancel`, see lib/api/public.ts callVisitorTool).
// The ownership gate is in calendar_cancel's resolveConvBooking: the event_id must belong to the booking of **this
// session's conversation**, otherwise it returns a booking_not_found tool-error (deletes no event). Dispatch normalizes
// tool-level errors to 200+isError (not HTTP 404), so what's asserted here is the **real security property**: whether cancel actually succeeded.
// Returns true only when the tool replies {cancelled:true} (really cancelled).
async function attemptCancel(
  request: APIRequestContext, session: VisitorSession, eventID: string,
): Promise<boolean> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${session.conversation_id}/tools/calendar_cancel`,
    {
      headers: { Authorization: `Bearer ${session.session_token}` },
      data: { event_id: eventID },
    },
  );
  const body = await res.json() as { result?: { cancelled?: boolean } };
  return body.result?.cancelled === true;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
