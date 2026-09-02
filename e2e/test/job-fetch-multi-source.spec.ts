// job-fetch-multi-source.spec.ts —— register 2 sources of different kinds;
// fetch_new with no source_id returns the union, each tagged with its
// source_kind.

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

test.describe('jobs.fetch_new across multiple registered sources', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('union of two source kinds returned in one fetch_new call',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'multi-spec');
      const sid = await initMCP(request, token);

      await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      await jobsRegisterSource(request, token, sid, {
        kind: 'lever', label: 'LeverDemo', config: { company: 'leverdemo' },
      });

      const fetched = await jobsFetchNew(request, token, sid);
      const kinds = new Set(fetched.jobs.map((j) => j.source_kind));

      expect(kinds.has('greenhouse')).toBe(true);
      expect(kinds.has('lever')).toBe(true);
      expect(fetched.jobs.length).toBeGreaterThan(0);

      // Every fetched job carries a cache_id (Redis 1d TTL ref)
      for (const j of fetched.jobs) {
        expect(j.cache_id).toMatch(/^[A-Za-z0-9_-]{8,}$/);
      }
    });

  // F-E-6 —— one source failing to fetch must never throw away what the other
  // sources fetched.
  //
  // Found while manually driving this module: of seven sources, only workable's token
  // was wrong, and as a result **none of the other six real sources' jobs made it into
  // the pool** — the owner got a bare `jobs.fetch_new failed`, while the backend logs
  // had the source id / kind / URL / reason all present. The comment above the
  // `return nil, ferr` line in the code said "a single source failure doesn't block
  // the others" — the invariant the comment declares is the exact opposite of what the
  // code does ([[names-that-lie]]).
  //
  // Asserts two things, neither optional:
  //   1. The good source's job **is still there** (this must be red on the old code:
  //      the old code returned 0 jobs)
  //   2. The bad source is **named** in `failed_sources` (otherwise the owner only
  //      knows "something's missing", not which source)
  // Asserting only #1 would let an implementation that "silently skips the bad source
  // and says nothing" pass too — that's a different kind of lie.
  test('one source with bad credentials must not zero out the other sources',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'isolation-spec');
      const sid = await initMCP(request, token);

      const good = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'GoodBoard', config: { company: 'airbnb' },
      });
      const bad = await jobsRegisterSource(request, token, sid, {
        kind: 'workable', label: 'BadToken', config: { company: 'nope', api_token: 'wrong' },
      });

      const fetched = await jobsFetchNew(request, token, sid);

      // Count **what's new in the pool from this run**, not how many total are in the
      // pool: the response now hands back the entire window (F-E-29), and an earlier
      // test case in this same file already put jobs into that same pool — with
      // `jobs.length`, this test would go green even if the good source fetched
      // nothing at all ([[assertion-that-cannot-fail]]).
      expect(
        fetched.jobs.filter((j) => j.new).length,
        `the good source (${good.label}) returned nothing because ${bad.label} failed`,
      ).toBeGreaterThan(0);

      const failed = fetched.failed_sources ?? [];
      expect(
        failed.map((f) => f.label),
        'the failing source must be named, not silently skipped',
      ).toContain('BadToken');
      expect(
        failed.find((f) => f.label === 'BadToken')?.reason ?? '',
        'the reason must carry the upstream detail the log already has',
      ).not.toBe('');
    });
});
