// admin-gcal-policy-edit.spec.ts —— owner edits booking policy (lead
// time, weekdays, working hours, timezone) and the changes persist.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  getBookingPolicy, setBookingPolicy, patchBookingPolicyStatus,
} from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

test.describe('admin · booking policy edit', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('defaults are 2-day lead / Mon-Fri / 09:00-18:00 / buffer 15', async () => {
    const p = await getBookingPolicy(seed.request);
    expect(p.min_lead_days).toBe(2);
    expect(p.allowed_weekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(p.working_hours_start).toBe('09:00');
    expect(p.working_hours_end).toBe('18:00');
    expect(p.buffer_min).toBe(15);
  });

  test('owner changes lead time + hours + weekdays → reflected on reload',
    async () => {
      await setBookingPolicy(seed.request, seed.csrf, {
        min_lead_days: 3,
        allowed_weekdays: ['tue', 'wed', 'thu'],
        working_hours_start: '10:00',
        working_hours_end: '16:00',
      });
      const p = await getBookingPolicy(seed.request);
      expect(p.min_lead_days).toBe(3);
      expect(p.allowed_weekdays).toEqual(['tue', 'wed', 'thu']);
      expect(p.working_hours_start).toBe('10:00');
      expect(p.working_hours_end).toBe('16:00');
    });

  test('min_lead_days must be a positive integer → 0 and negative are rejected (400)',
    async () => {
      for (const bad of [0, -1]) {
        const status = await patchBookingPolicyStatus(
          seed.request, seed.csrf, { min_lead_days: bad },
        );
        expect(status).toBe(400);
      }
      // unchanged: still the last valid value (3 from the previous test)
      expect((await getBookingPolicy(seed.request)).min_lead_days).toBe(3);
    });

  // When no timezone has been saved, this control **must not show a timezone that was
  // never saved**.
  //
  // The previous version showed the browser's own timezone (UX-11: to dodge option[0],
  // the "-11:00 American Samoa" entry). Dodging that was right, but the cost was never
  // caught: the screen read America/Toronto while the store held an empty string, and
  // `book.go` reads an empty string as **UTC** — so the owner's 09:00–18:00 gets
  // evaluated against UTC, and the first slot a visitor gets is 05:18 Toronto time
  // (F-B-5 ⭐). **The displayed timezone is not the one being evaluated**, and this
  // case is exactly what pins that down.
  //
  // This case runs before the "pick one → it saves" case below, so at this point
  // policy.timezone is still empty.
  test('nothing saved yet → the picker says so, and the panel names what is used meanwhile',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      const select = adminPage.getByTestId('gcal-timezone');
      await expect(select).toBeVisible({ timeout: 10_000 });

      // The store is empty — positive control, otherwise the two assertions below
      // could be passing on an instance whose timezone was **already set**.
      expect((await getBookingPolicy(seed.request)).timezone).toBe('');
      // The control shows exactly that emptiness — not any specific timezone.
      await expect(
        select,
        'an unsaved timezone must not be shown as if it were configured — the engine reads the '
          + 'stored value, and a picker showing something else is the screen telling a lie',
      ).toHaveValue('');
      // And empty **does not mean** no consequence: the panel must state clearly which
      // timezone is used before one is picked.
      await expect(
        adminPage.getByTestId('gcal-timezone-unset'),
        'unset has a consequence (hours are read as UTC) and the owner must be able to see it',
      ).toContainText('UTC', { timeout: 10_000 });
    });

  // timezone is a real <select> (IANA list from @vvo/tzdb), not free text —
  // picking one in the UI persists. seed owner is alice (= default adminPage creds).
  test('owner picks a timezone from the dropdown → persists',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      const select = adminPage.getByTestId('gcal-timezone');
      await expect(select).toBeVisible({ timeout: 10_000 });
      await select.selectOption('Asia/Tokyo'); // option value is the IANA name
      await expect.poll(
        async () => (await getBookingPolicy(seed.request)).timezone,
        { timeout: 10_000 },
      ).toBe('Asia/Tokyo');
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
