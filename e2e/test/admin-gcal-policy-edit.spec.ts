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

  // 没存过时区时，这个控件**不许显示一个没存过的时区**。
  //
  // 上一版显示的是浏览器自己的时区（UX-11：为了躲开 option[0] 那个 "-11:00 American Samoa"）。
  // 躲开是对的，代价没被接住：屏幕上写着 America/Toronto，而库里是空串，`book.go` 把空串读成
  // **UTC** —— owner 设的 09:00–18:00 于是在 UTC 上判，访客拿到的第一个时段是多伦多凌晨
  // 05:18（F-B-5 ⭐）。**显示的时区不是被评估的那个**，而这条用例正是把那件事钉住的地方。
  //
  // 这一条跑在下面那条「选一个 → 存下来」之前，所以此刻 policy.timezone 还是空的。
  test('nothing saved yet → the picker says so, and the panel names what is used meanwhile',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      const select = adminPage.getByTestId('gcal-timezone');
      await expect(select).toBeVisible({ timeout: 10_000 });

      // 库里是空的 —— 正对照，否则下面两条可能是在一台**已经设过**时区的实例上过的。
      expect((await getBookingPolicy(seed.request)).timezone).toBe('');
      // 控件显示的就是那个空 —— 不是任何一个具体时区。
      await expect(
        select,
        'an unsaved timezone must not be shown as if it were configured — the engine reads the '
          + 'stored value, and a picker showing something else is the screen telling a lie',
      ).toHaveValue('');
      // 而空**不等于**没有后果：面板要说清楚在选之前时间按哪儿算。
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
