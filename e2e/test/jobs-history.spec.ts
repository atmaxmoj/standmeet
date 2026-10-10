// jobs-history.spec.ts —— roadmap 8.3.a: the ledger read back by day, one page at a time.
//
// "Done" (roadmap): records on three days; a day range returns exactly those days; paging loses
// nothing and repeats nothing.
//
// Contract: fixtures/job-ledger.ts (jobs.history). The days are made by winding first_seen_at back
// in `job_seen` with SQL: no endpoint should move it.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL } from '@/fixtures/instance';
import { allHistory, jobsAnnotate, jobsHistory, jobsRecord, type Posting } from '@/fixtures/job-ledger';
import { gotoAdminSection } from '@/fixtures/navigate';

let o: LoopOwner;
const byDay: Record<'d0' | 'd1' | 'd2', string[]> = { d0: [], d1: [], d2: [] };

const day = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);

function postings(tag: string): Posting[] {
  return [1, 2].map((n) => ({
    title: `History Engineer ${tag}${n}`, company: 'History Co', location: 'Remote',
    url: `https://jobs.history.example/${tag}${n}`,
  }));
}

test.use({ ownerCredentials: { email: 'jobshistory@example.com', password: 'correct-horse-battery-staple' } });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'jobshistory');
  for (const [key, back] of [['d2', 2], ['d1', 1], ['d0', 0]] as const) {
    const recorded = await jobsRecord(o, postings(key));
    byDay[key] = recorded.map((r) => r.job_seen_id);
    if (back > 0) {
      execSQL(`UPDATE job_seen SET first_seen_at = now() - interval '${back} days', last_seen_at = now() - interval '${back} days'
        WHERE id IN (${byDay[key].map((id) => `'${id}'`).join(',')})`);
    }
  }
});
test.afterAll(async () => { await o.request.dispose(); });

test('a day range returns exactly the rows first seen on those days', async () => {
  const twoDaysAgo = (await allHistory(o, { from: day(2), to: day(2) })).map((r) => r.job_seen_id);
  expect(twoDaysAgo.sort(), 'the day two days ago: its two rows, nothing else').toEqual([...byDay.d2].sort());
  const recent = (await allHistory(o, { from: day(1) })).map((r) => r.job_seen_id);
  expect(byDay.d1.every((id) => recent.includes(id)), 'yesterday is in "from yesterday"').toBe(true);
  expect(byDay.d0.every((id) => recent.includes(id)), 'today is in "from yesterday"').toBe(true);
  expect(byDay.d2.some((id) => recent.includes(id)), 'two days ago is not').toBe(false);
});

// 8.3.b —— the panel: /admin/listings has a history view (chip `listings-view-history`), rows grouped
// under `listings-history-day-<YYYY-MM-DD>`, each row `history-row-<job_seen_id>`; opening one shows
// its assessment in `history-detail-<job_seen_id>`.
test('8.3.b — the panel shows a posting from two days ago under its day, with its deductions', async ({ adminPage: page }) => {
  const id = byDay.d2[0]!;
  await jobsAnnotate(o, id, { score: 4, reason: 'ZEBRAREASON thin overlap', deductions: [{ points: -2, why: 'ZEBRAWHY on-site five days' }] });
  await gotoAdminSection(page, 'listings');
  await page.getByTestId('listings-view-history').click();
  const dayGroup = page.getByTestId(`listings-history-day-${day(2)}`);
  await expect(dayGroup, 'the day two days ago has its own group').toBeVisible({ timeout: 15_000 });
  const row = dayGroup.getByTestId(`history-row-${id}`);
  await expect(row, 'the posting sits under its day').toContainText('History Engineer d21');
  await row.click();
  const detail = page.getByTestId(`history-detail-${id}`);
  await expect(detail).toContainText('ZEBRAREASON');
  await expect(detail).toContainText('ZEBRAWHY');
  await expect(page.getByTestId(`listings-history-day-${day(0)}`).getByTestId(`history-row-${id}`), 'not under today').toHaveCount(0);
});

test('paging three at a time loses nothing and repeats nothing; newest first', async () => {
  const whole = (await jobsHistory(o, { limit: 200 })).items.map((r) => r.job_seen_id);
  expect(whole.length, 'presence: the ledger holds the six plus the pooled board').toBeGreaterThan(6);
  const paged = (await allHistory(o, { limit: 3 })).map((r) => r.job_seen_id);
  expect(new Set(paged).size, 'no row twice').toBe(paged.length);
  expect(paged, 'the same rows in the same order').toEqual(whole);
  expect(whole.indexOf(byDay.d0[0]!), 'today before two days ago').toBeLessThan(whole.indexOf(byDay.d2[0]!));
});
