// chat-quota-exhausted-tells-the-model.spec.ts — F-B-14 star-star: **a spent allowance must
// be said out loud, and it must say "what already succeeded still counts."**
//
// Caught while driving booking-book check 4 in prod (2026-08-21, a real code with
// max_bookings=2, real Google): the first two bookings really went through (a receipt card
// + calendar entry + invite email), and after the third request the AI said *"I don't have
// calendar-booking access right now … those first two confirmations were wrong: nothing
// actually got booked … No invites went out to anyone."* — while both meetings sat fine on
// the owner's calendar. **The product talked two real bookings into a cancellation.**
//
// The cause is in the shape of the gate, not the model's temperament: once the allowance
// runs out, the host hides the whole capability, so that turn's agent
//   · has no booking tool in hand,
//   · **still has** the "you can book meetings" instructions left in the system prompt
//     (the fragment never checks the gate),
//   · and gets **not a single sentence** telling it "you had this, you used it up, and the
//     previous two still count."
// "Never had it" and "used it up" are the same evidence to the model, and the model's most
// natural repair for that evidence is to doubt its own recent output.
//
// The judgment criterion rests on **what the product tells the model**, not a bet on what
// the model will say ([[faicheck-deterministic-llm-loop-bug]] family): the message sent out
// on the turn where the allowance runs out must carry this sentence. Plus one positive
// control — the earlier booking **really did go through** (it's on the calendar), otherwise
// "allowance exhausted" never actually happened and the assertion would be meaningless.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText, scriptMockToolCall, sendAndDrain,
} from '@/fixtures/mock-llm-script';

// ALLOWANCE_MARK — the qualifier inside the sentence the host writes for this capability
// once its allowance runs out. Only that sentence writes this phrase, so a hit means the
// model really was told (using a tool name as the needle couldn't fail: the tool list is
// already in the prompt regardless).
const ALLOWANCE_MARK = 'used up';

test.describe.serial('F-B-14 · a spent allowance is said out loud, and past results stand', () => {
  let seed: CodedSeed;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 1,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the turn after the allowance runs out carries the fact, not silence', async () => {
    test.setTimeout(180_000);
    const r: APIRequestContext = seed.request;
    await resetGatewayRequests(r);

    // 1) Spend this code's one and only allowance — book a real meeting (a real event
    // appears on the mock provider).
    const bookTag = await scriptMockToolCall(r, {
      name: 'calendar_book',
      args: { topic: 'the only one', duration_min: 30, preferred_times: [future(5, 14)] },
    });
    await sendAndDrain(r, seed.visitor, `book me a 30-minute call${bookTag}`);

    // Positive control: the allowance really was spent — not "nothing ever succeeded."
    const evs = await getMockEvents(r);
    expect(
      evs.some((e) => e.summary.includes('the only one')),
      'guard: the first booking really happened, so the allowance really is spent',
    ).toBe(true);

    // 2) Ask again. The tool is no longer available on this turn — the question is
    // whether the product told the model **why**.
    const nextTag = await scriptMockReplyText(r, 'noted');
    await sendAndDrain(r, seed.visitor, `book me another one, please${nextTag}`);

    await expect.poll(
      async () => (await lastGatewayRequest(r, nextTag, ALLOWANCE_MARK)).found,
      { timeout: 30_000, message: 'the turn reached the model' },
    ).toBe(true);
    const req = await lastGatewayRequest(r, nextTag, ALLOWANCE_MARK);

    expect(
      req.contains,
      'the model is told the allowance is spent — without it, "no tool" and "never had one" are '
      + 'the same evidence, and the agent talks itself into retracting bookings that really exist',
    ).toBe(true);
  });
});

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
