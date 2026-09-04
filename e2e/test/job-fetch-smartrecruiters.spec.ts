// job-fetch-smartrecruiters.spec.ts —— the SmartRecruiters source **had no e2e at all before**
// (the fixture `visa.day1.json` was sitting on disk, with no matching route in the mock).
//
// The vendor's rules are measured, not copied from the docs (real API hit on 2026-08-16): request
// `?limit=200`, and the response body comes back with **`"limit":100`** — it **silently clamps to
// 100**, neither erroring nor announcing that it clamped. And the adapter finished after a single
// request, without even decoding `totalFound` — so a company with more than 100 postings silently
// had only its first 100 in the pool, indistinguishable on screen from "this company just has that
// many" (F-E-16).
//
// 137 postings = 20/20/… no, 100 + 37 across two pages: the middle page **full**, the last page
// short. Assert the **exact count**, not "greater than 0" — "fetched some" is exactly the kind of
// green this check guards against.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'srjobs@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'srjobs',
  fullName: 'SR Jobs Owner',
};

// PAGED_TOTAL —— the posting count of the synthetic company in the mock (`pagedPostings`). Two pages: 100 + 37.
const PAGED_TOTAL = 137;

test.describe('jobs.fetch_new · smartrecruiters', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('a fixture company surfaces its postings', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'sr-spec');
    const sid = await initMCP(request, token);

    const src = await jobsRegisterSource(request, token, sid, {
      kind: 'smartrecruiters', label: 'Visa SR', config: { company: 'visa' },
    });
    const fetched = await jobsFetchNew(request, token, sid, src.id);
    expect(fetched.failed_sources ?? []).toHaveLength(0);
    expect(fetched.jobs.length, '夹具里有 8 条').toBe(8);
    const first = fetched.jobs[0];
    expect(first?.company, 'company 从 source config 来').toBe('visa');
    expect(first?.url, 'URL 指向厂商的 posting 页').toContain('jobs.smartrecruiters.com/visa/');
  });

  test('a company past the vendor page cap → every page is consumed', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'sr-paged-spec');
    const sid = await initMCP(request, token);

    const src = await jobsRegisterSource(request, token, sid, {
      kind: 'smartrecruiters', label: 'PagedCo SR', config: { company: 'pagedco' },
    });
    const fetched = await jobsFetchNew(request, token, sid, src.id);
    expect(fetched.failed_sources ?? []).toHaveLength(0);
    // Count **what this run newly fetched from this source**: the receipt now hands back the entire
    // pool window (F-E-29), and an earlier case in this file already put other companies' jobs in the pool.
    const paged = fetched.jobs.filter((j) => j.new && j.source_id === src.id);
    expect(paged, `全集 ${PAGED_TOTAL} 条，翻页要翻到底`).toHaveLength(PAGED_TOTAL);
    const ids = new Set(paged.map((j) => j.external_id));
    expect(ids.size, '每条只出现一次（翻页不许重复取同一页）').toBe(PAGED_TOTAL);
    const titles = paged.map((j) => j.title);
    expect(titles, '第二页的条目也要在（停在第一页会缺它）').toContain('Engineer 0136');
    // The tally must add up too: seen == full set means the adapter handed back all of them, not "enough to fill the screen".
    const tally = (fetched.sources ?? []).find((t) => t.source_id === src.id);
    expect(tally?.seen, '这一趟的账要报 137').toBe(PAGED_TOTAL);
  });
});
