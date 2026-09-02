// job-fetch-workday-bamboohr.spec.ts — J.6b: two new direct ATS adapters,
// workday (CXS POST) + bamboohr (careers/list GET): register + fetch_new.
// Parallel to the JBA one; hits the real ATS instead of an aggregating archive.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('jobs.fetch_new (workday + bamboohr) direct ATS adapters', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('workday: POST CXS endpoint → 2 fixture jobs surface',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workday-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workday',
        label: 'Acme Workday',
        config: { tenant: 'acme', wd: '5', site: 'careers' },
      });
      expect(src.kind).toBe('workday');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs).toHaveLength(2);
      const titles = fetched.jobs.map((j) => j.title);
      expect(titles).toContain('Senior Software Engineer (Backend)');
      expect(titles).toContain('Staff Data Scientist');
    });

  // The real Workday CXS caps each page at 20 entries and returns a flat 400 above
  // that (measured against two real tenants on 2026-08-16: `redhat` / `nvidia`,
  // `limit:20` → 200, **`limit:21` → 400**). The adapter had `limit:100` hardcoded, so
  // it **fetched zero results against real Workday** (F-E-15), while this spec stayed
  // green the whole time — the old mock accepted any limit without complaint
  // ([[which-path-is-the-green-on]]).
  //
  // This test also pins down a second thing: **every page must be read to the end**
  // (F-E-16). 45 entries = three pages of 20/20/5; only following the offset all the
  // way through adds up to that. Stopping at the first page gets 20; stopping at the
  // 400 gets 0. The assertion checks for **exactly 45**, not "more than 0" — "fetched
  // some" is exactly the kind of green this check exists to catch.
  //
  // **Why the middle page must be full**: the real Workday only reports `total` on the
  // first page, reporting 0 on every page after (verified against nvidia). With a
  // 25-entry fixture, the second page happens to be short, so the bug of "trusting a
  // later page's total" would still add up to the correct 25 — green with zero
  // information value ([[assertion-that-cannot-fail]]). 45 entries forces it out: the
  // wrong stopping condition would stop at 40.
  test('workday: 45 postings over three pages → every page is consumed',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workday-paged-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workday',
        label: 'BigCo Workday',
        config: { tenant: 'bigco', wd: '5', site: 'careers' },
      });

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.failed_sources ?? [], '取数不该失败：limit 必须落在 vendor 的合法范围内')
        .toHaveLength(0);
      // Count **only what this source freshly fetched this run**: the receipt hands
      // back the whole pool window (F-E-29), and the earlier test in this same file
      // already put other postings into the pool.
      const paged = fetched.jobs.filter((j) => j.new && j.source_id === src.id);
      expect(paged, '全集 45 条，翻页要翻到底').toHaveLength(45);
      const ids = new Set(paged.map((j) => j.external_id));
      expect(ids.size, '每条只出现一次（翻页不许重复取同一页）').toBe(45);
      const titles = paged.map((j) => j.title);
      expect(titles, '第二页的条目要在（错的停止条件会停在这之前）')
        .toContain('Staff Engineer, Identity');
      expect(titles, '第三页的条目也要在').toContain('Staff Engineer, Observability');
    });

  test('bamboohr: GET careers/list → 3 fixture jobs (incl null location)',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'bamboohr-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'bamboohr',
        label: 'Zeta BambooHR',
        config: { company: 'zeta' },
      });
      expect(src.kind).toBe('bamboohr');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      // The 3 entries this source freshly fetched this run (the receipt hands back the
      // whole pool window, F-E-29 — the previous test's 45 workday entries are still
      // in there).
      const mine = fetched.jobs.filter((j) => j.new && j.source_id === src.id);
      expect(mine).toHaveLength(3);
      const titles = mine.map((j) => j.title);
      expect(titles).toContain('Senior Backend Engineer');
      expect(titles).toContain('Product Designer');
      // null location → empty string, must not crash or drop the entry
      expect(titles).toContain('Customer Success Manager');
      // the tag includes department + employmentStatus
      const backend = mine.find((j) => j.title === 'Senior Backend Engineer');
      expect(backend?.tags).toContain('Engineering');
      expect(backend?.tags).toContain('Full-Time');
    });
});
