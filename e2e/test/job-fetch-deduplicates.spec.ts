// job-fetch-deduplicates.spec.ts —— fetch_new the same source twice;
// second call returns 0 jobs (all fingerprinted). Then mock switches to
// day=2 (drops first 2 ids + appends 2 synthetic) and fetch_new returns
// the 2 synthetic ids only.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  MOCK_SYNTHETIC_DAY2,
  jobsFetchNew, jobsRegisterSource, mockSetDay,
} from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('jobs.fetch_new dedups against fingerprints', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // The criterion is about **deduplication**: the same posting never enters the pool a
  // second time.
  // It used to be written as "the second fetch returns an empty array" -- but that
  // wording was also the F-E-29 defect itself (the pool being invisible on the owner's
  // side). Now the same fact is stated by `new` and this fetch's tally: the board still
  // comes back whole, but **none of it is newly pooled**.
  test('fetch twice → nothing new pooled; mock day=2 → only 2 synthetic ids are new',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'dedup-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });

      // First fetch: all 8 day1 jobs returned
      const first = await jobsFetchNew(request, token, sid, source.id);
      expect(first.jobs.length).toBeGreaterThan(0);
      const day1IDs = first.jobs.map((j) => j.external_id);

      // Second fetch (same day): all already fingerprinted → nothing NEW pooled,
      // while the board itself stays visible.
      const second = await jobsFetchNew(request, token, sid, source.id);
      expect(second.jobs.filter((j) => j.new)).toHaveLength(0);
      expect(second.jobs.length, '板子照旧整块在（F-E-29）').toBe(first.jobs.length);
      const tally = (second.sources ?? []).find((t) => t.source_id === source.id);
      expect(tally?.pooled, '这一趟一条都没新进池子').toBe(0);

      // Switch mock to day 2 (drops first 2 ids + appends 2 synthetic)
      await mockSetDay(request, 'greenhouse', 2);

      // Third fetch: only the 2 synthetic ids are new (everything else either gone
      // from upstream or already fingerprinted)
      const third = await jobsFetchNew(request, token, sid, source.id);
      const newIDs = third.jobs.filter((j) => j.new).map((j) => j.external_id).sort();
      const expected = [...MOCK_SYNTHETIC_DAY2.greenhouse].sort();
      expect(newIDs).toEqual(expected);

      // Sanity: synthetic ids are NOT in day1 set (they're stable mocks)
      for (const id of MOCK_SYNTHETIC_DAY2.greenhouse) {
        expect(day1IDs).not.toContain(id);
      }
    });
});
