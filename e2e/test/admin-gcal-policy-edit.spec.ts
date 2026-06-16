// admin-gcal-policy-edit.spec.ts —— owner edits booking policy (lead
// time, weekdays, working hours, timezone) and the changes persist.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  getBookingPolicy, setBookingPolicy,
} from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

test.describe('admin · booking policy edit', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('defaults are 24h lead / Mon-Fri / 09:00-18:00 / buffer 15', async () => {
    const p = await getBookingPolicy(seed.request);
    expect(p.min_lead_hours).toBe(24);
    expect(p.allowed_weekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(p.working_hours_start).toBe('09:00');
    expect(p.working_hours_end).toBe('18:00');
    expect(p.buffer_min).toBe(15);
  });

  test('owner changes lead time + hours + weekdays → reflected on reload',
    async () => {
      await setBookingPolicy(seed.request, seed.csrf, {
        min_lead_hours: 48,
        allowed_weekdays: ['tue', 'wed', 'thu'],
        working_hours_start: '10:00',
        working_hours_end: '16:00',
      });
      const p = await getBookingPolicy(seed.request);
      expect(p.min_lead_hours).toBe(48);
      expect(p.allowed_weekdays).toEqual(['tue', 'wed', 'thu']);
      expect(p.working_hours_start).toBe('10:00');
      expect(p.working_hours_end).toBe('16:00');
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
