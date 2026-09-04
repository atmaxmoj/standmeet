// owner-transcript-shows-card-action.spec.ts —— the third face of F-B-9: **the owner reads the transcript afterward**.
//
// "The owner can read the visitor's conversation" is this product's promise to the owner. But what the
// visitor did on the sandbox card (clicked Cancel meeting) takes a different path: once persisted its
// role is `event` —— not something anyone said.
//
// On that face the original mapping was "not a visitor, so treat as assistant", so a line like this gets
// labelled `AI`: the owner reads "**the AI said** it cancelled this meeting", when the AI never said that
// ([[collapsed-error-class-kills-its-own-branch]]: the upstream collapses classes into one, and the cell
// written for this one can never surface).
//
// This spec guards two things, neither optional:
//   1. the event is **visible** on the owner's transcript (it must not exist only on the visitor side);
//   2. it is **not** attributed to the AI.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import {
  OWNER, seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const VISITOR = 'Transcript Tess';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-B-9 · the owner reads what the visitor did on the card', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 3,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('a card action is in the transcript, and it is not attributed to the AI',
    async ({ browser, adminPage }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code);

      const bookTag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: 'Transcript check', duration_min: 30, preferred_times: [future(5, 16)] },
      });
      await ask(page, `book me a 30-minute chat, please${bookTag}`);
      await expect(page.getByTestId('mcp-app-card-calendar_book'))
        .toBeVisible({ timeout: 30_000 });

      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 30_000 });
      await ctx.close();

      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText(VISITOR, { exact: true }).click();
      const modal = adminPage.getByTestId('transcript-body');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      // First prove the conversation really is in this modal, otherwise the assertions below are
      // searching an empty modal ([[two-guards-dying-at-one-line]]).
      await expect(modal, 'the conversation itself is in the transcript')
        .toContainText('book me a 30-minute chat');

      const event = modal.getByTestId('conv-event-line');
      await expect(event, 'the owner can see what the visitor did on the card')
        .toBeVisible({ timeout: 10_000 });
      await expect(event, 'and which action it was').toContainText('calendar_cancel');

      // Attribution: this line was not said by the AI. The positive assertion above already holds, so
      // this negation is not passing on an empty set ([[negated-assertion-passes-while-absent]]).
      await expect(
        modal.locator('li').filter({ hasText: 'card action' }).locator('.mono')
          .filter({ hasText: /^ai$/ }),
        'no AI label sits on the card action — the AI never said it',
      ).toHaveCount(0);
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

async function enterChat(page: Page, code: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(VISITOR);
  await page.getByTestId('visitor-email-input').fill('tess@example.com');
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
