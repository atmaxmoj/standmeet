// booking-invite-caldav.spec.ts -- F-C-61 / F-C-62 / F-C-63. On a CalDAV calendar, the visitor
// really receives the calendar invite and the cancellation; the card says only what happened.
//
// What happened in the real environment (v0.1.76 release smoke, sijie.xyz on iCloud CalDAV + SMTP):
//   - F-C-61: the card and the chat said "calendar invite emailed to <visitor>", and nothing
//     arrived. The CalDAV block PUTs a VEVENT with an ATTENDEE line and no ORGANIZER; iCloud does
//     not mail anyone for that. `invited_email` was the session's email, returned unconditionally —
//     a claim, not a receipt. Google sends its own invite (sendUpdates=all); CalDAV sends none, so on
//     CalDAV the product itself must mail the invite (iTIP METHOD:REQUEST) through the mail seam.
//   - F-C-62: the card offered "View on Google Calendar" and linked the owner's private CalDAV .ics
//     URL — a login-walled resource that is not a page, on a calendar that is not Google.
//   - F-C-63: a cancel told nobody. Google mails the attendee on delete (sendUpdates=all); a CalDAV
//     DELETE does not, so the product must mail the iTIP METHOD:CANCEL for the same UID.
//
// Assertions are what the visitor holds: the mail in their inbox (raw source, since the invite is a
// text/calendar part) and the card they see.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, FrameLocator, Page } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { connectCalDAVBlock, getCalDAVEvents, resetCalDAV } from '@/fixtures/caldav-mock';
import { setBookingPolicy } from '@/fixtures/gcal';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { clearMailpit, configureMailSupplier, waitForRawMailToContaining } from '@/fixtures/mail';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { openReader } from '@/fixtures/navigate';
import { activateSupplier } from '@/fixtures/supplier-card';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const CALDAV_MOCK = process.env['CALDAV_MOCK_URL'] ?? 'http://localhost:9000';
const CALDAV_API = 'http://external-mock:9000'; // how the backend container reaches the mock
const COLL = 'caldav'; // the shipped CalDAV block's id = its mock collection

const OWNER = {
  email: 'caldav-invite@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'calinvite',
  fullName: 'Cal Invite Owner',
};
const GUEST = 'carla.guest@example.com';

test.describe('F-C-61/62/63 · CalDAV booking: the visitor gets the invite and the cancellation', () => {
  let request: APIRequestContext;
  let code: string;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(150_000);
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    await resetCalDAV(request, CALDAV_MOCK, COLL);
    await connectCalDAVBlock(request, { backend: BACKEND, mockApi: CALDAV_API, csrf, coll: COLL });
    await activateSupplier(request, csrf, COLL);
    await configureMailSupplier(request, OWNER.email, OWNER.password);
    const fresh = await login(request, OWNER.email, OWNER.password);
    await setBookingPolicy(request, fresh.csrf, {
      allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], min_lead_days: 1,
    });
    code = (await issueCodeWithSkills(request, fresh.csrf, {
      granted_skills: ['calendar.book'], max_bookings: 5,
    })).code;
  });
  test.afterAll(async () => { await request.dispose(); });

  test('book → invite (REQUEST) in the visitor inbox, honest card → cancel → CANCEL in the inbox',
    async ({ browser }) => {
      await clearMailpit(request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, code, 'Carla', GUEST);
      await bookOnce(page, 9);
      const card = bookedFrame(page);

      const events = await getCalDAVEvents(request, CALDAV_MOCK, COLL);
      expect(events, 'the booking landed on the CalDAV calendar').toHaveLength(1);
      const uid = events[0]!.uid;
      expect(uid, 'the CalDAV event has a UID').not.toBe('');

      await test.step('F-C-61: the invite reaches the visitor, tied to the calendar event', async () => {
        const invite = await waitForRawMailToContaining(request, GUEST, 'METHOD:REQUEST');
        expect(invite, 'the invite is a text/calendar part').toMatch(/text\/calendar/i);
        expect(unfold(invite), 'the invite carries the event UID').toContain(`UID:${uid}`);
        expect(unfold(invite), 'the visitor is an attendee').toMatch(new RegExp(`ATTENDEE[^\\n]*mailto:${GUEST}`, 'i'));
        await expect(card.getByTestId('book-card-invite'), 'the card names the address that got it')
          .toContainText(GUEST, { timeout: 20_000 });
      });

      await test.step('F-C-62: the card does not offer the owner\'s private .ics as a calendar page', async () => {
        await expect(card.getByTestId('book-card-time')).toBeVisible();
        await expect(card.getByTestId('book-card-link')).toHaveCount(0);
      });

      await test.step('F-C-63: cancelling mails the visitor a CANCEL for the same UID', async () => {
        await card.getByTestId('book-card-cancel').click();
        await expect(card.getByTestId('tool-card-calendar_book'))
          .toHaveAttribute('data-cancelled', 'true', { timeout: 15_000 });
        const cancel = await waitForRawMailToContaining(request, GUEST, 'METHOD:CANCEL');
        expect(unfold(cancel), 'the cancel names the same event').toContain(`UID:${uid}`);
      });
      await ctx.close();
    });
});

// unfold —— undo MIME and iCalendar line folding so a long property reads as one line.
function unfold(raw: string): string {
  return raw.replace(/=\r?\n/g, '').replace(/\r?\n[ \t]/g, '');
}

async function bookOnce(page: Page, days: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(days, 14)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book'), 'booked card visible')
    .toBeVisible({ timeout: 20_000 });
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

async function enterChat(page: Page, codeStr: string, name: string, email: string): Promise<void> {
  await openReader(page, `/?code=${codeStr}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-email-input').fill(email);
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
