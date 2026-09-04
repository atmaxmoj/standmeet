// connector-err-mcp-ui-tool-dispatch.spec.ts —— §4 error stream matrix E12 (R4 new path)
// a sandbox card posts `mcp-ui:tool` to dispatch a named tool → host dispatches it with session context. Three failures:
//   (a) host dispatch itself fails,
//   (b) session invalid/expired,
//   (c) quota exhausted mid-card-action,
// each should show a friendly result in the card, and the chat **must not hang or crash**.
//
// Error stream E12: a sandbox card posts mcp-ui:tool but the dispatch path fails —
// (a) host dispatch error, (b) invalid/expired session, (c) quota exhausted
// mid-card-action — in each case the card shows a friendly result and the chat
// does not hang or crash.
//
// RED / TDD: goes green once mcp-ui:tool host dispatch maps these three failure classes into friendly in-card results.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import { configureMailConnector, clearMailpit } from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';
const TOOL_ROUTE = '**/api/v1/sessions/*/tools/send_confirmation';

// the three dispatch faults are produced by hijacking the card's /tools request with Playwright (no backend change, no test seam):
//   (a) host dispatch fails → 502; (b) session invalid → 401; (c) quota exhausted → 200 ok:false.
// the card's mcp-ui:tool is fetched by the parent page's callVisitorTool, so page.route can intercept it.
async function failHostDispatch(page: Page): Promise<void> {
  await page.route(TOOL_ROUTE, (route) => route.fulfill({
    status: 502, contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'dispatch_fault' }),
  }));
}
async function expireSession(page: Page): Promise<void> {
  await page.route(TOOL_ROUTE, (route) => route.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'session_expired' }),
  }));
}
async function exhaustCardActionQuota(page: Page): Promise<void> {
  await page.route(TOOL_ROUTE, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'quota_exhausted' }),
  }));
}

test.describe('connector error stream · mcp-ui:tool dispatch failures degrade in-card (E12)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  // (a) host dispatch itself fails → friendly in-card result, chat does not hang.
  test('(a) host dispatch fails → card shows a friendly result, chat does not hang',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dana', 14, 'dana.a@example.com');

      await failHostDispatch(page);
      const frame = bookedFrame(page);
      await frame.getByTestId('booking-email-use-profile').click();

      await assertFriendlyCardError(frame);
      await assertChatAlive(page);
      await ctx.close();
    });

  // (b) session invalid/expired → dispatch rejected, friendly in-card result (prompts to re-enter), chat does not crash.
  test('(b) session invalid/expired → card shows a friendly result, chat does not crash',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Eli', 15, 'eli.b@example.com');

      await expireSession(page);
      const frame = bookedFrame(page);
      await frame.getByTestId('booking-email-use-profile').click();

      await assertFriendlyCardError(frame);
      await assertChatAlive(page);
      await ctx.close();
    });

  // (c) quota exhausted mid-card-action → friendly in-card result, chat does not hang.
  test('(c) quota exhausted mid-card-action → card shows a friendly result, chat does not hang',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Mara', 16, 'mara.c@example.com');

      await exhaustCardActionQuota(page);
      const frame = bookedFrame(page);
      await frame.getByTestId('booking-email-use-profile').click();

      await assertFriendlyCardError(frame);
      await assertChatAlive(page);
      await ctx.close();
    });
});

// assertFriendlyCardError —— a friendly error appears in the card (not sent, no stack).
async function assertFriendlyCardError(frame: FrameLocator): Promise<void> {
  const err = frame.getByTestId('booking-email-error');
  await expect(err, 'friendly in-card error').toBeVisible({ timeout: 10_000 });
  const text = (await err.textContent()) ?? '';
  expect(text, 'no stack / raw error in card')
    .not.toMatch(/panic|goroutine|stack|dial tcp|connection refused|500/i);
  await expect(frame.getByTestId('booking-email-prompt')).toHaveAttribute('data-sent', 'false');
}

// assertChatAlive —— after a dispatch failure the chat isn't hung: the input is still interactive (can send another message).
async function assertChatAlive(page: Page): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await expect(input, 'chat input still interactive (no hang)').toBeEnabled({ timeout: 10_000 });
  await input.fill('still here?');
  await expect(input).toHaveValue('still here?');
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterAndBook —— ?code entry → fill name + email → script calendar_book → wait for the sandbox card.
// returns conversation_id (for session/quota fault injection).
async function enterAndBook(
  page: Page, code: string, name: string, hour: number, email: string,
): Promise<string> {
  await goto(page, `/?code=${code}`);
  const sessionResp = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  const resolved = await sessionResp;
  const body = await resolved.json() as { conversation_id: string };

  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
  const frame = bookedFrame(page);
  await expect(frame.getByTestId('booking-email-prompt')).toBeVisible({ timeout: 10_000 });
  return body.conversation_id;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  const seed = await seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  await configureMailConnector(seed.request, OWNER.email, OWNER.password);
  return seed;
}
