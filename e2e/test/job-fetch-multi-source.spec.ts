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
      // Registered and then referred to by its label below, not by this handle: the
      // assertions name 'BadToken' because that is the string the owner sees in
      // failed_sources, and reading it back off the response is what proves the label
      // survived the round trip.
      await jobsRegisterSource(request, token, sid, {
        kind: 'workable', label: 'BadToken', config: { company: 'nope', api_token: 'wrong' },
      });

      const fetched = await jobsFetchNew(request, token, sid);

      // Never `jobs.length`: the response hands back the entire window (F-E-29) and an
      // earlier test in this file already filled that pool, so a total would be green even
      // if the good source fetched nothing at all ([[assertion-that-cannot-fail]]).
      //
      // WHICH source failed, asserted before how much the good one brought back.
      //
      // The order matters and it was the other way round, which cost a diagnosis: when
      // the good source returned nothing, the message read "the good source returned
      // nothing **because BadToken failed**" — a cause the spec never checked. A green
      // `toContain('BadToken')` is equally true when BOTH sources failed, so the one
      // reading that red had no way to tell "one bad source zeroes the others" (the
      // defect this file exists for) from "the good source happened to fail too".
      // Found by REPEAT=5: it failed on two runs and passed on two, which is not what a
      // source zeroing its neighbours looks like ([[plausible-cause-is-not-the-cause]]).
      const failed = fetched.failed_sources ?? [];
      expect(
        failed.map((f) => f.label),
        'the failing source must be named, not silently skipped',
      ).toContain('BadToken');
      expect(
        failed.map((f) => f.label),
        `the GOOD source failed on its own — this red is not about isolation: ` +
          JSON.stringify(failed),
      ).not.toContain(good.label);

      // **What the good source POOLED, not what the window shows as new.**
      //
      // This counted `jobs.filter(j => j.new)` and went red about one run in two. The cause
      // was never isolation: the first test in this file already fetched the same Greenhouse
      // company, so the pool holds those postings, and a posting that arrives again at the
      // same URL is a cross-source duplicate. The window surfaces one row per posting and
      // keeps the older one — which is not new — so the good source could pool everything it
      // fetched and still contribute zero rows carrying `new`.
      //
      // It flipped run to run because the survivor used to be decided by Redis SCAN order
      // (fixed: the pool now carries its write order in the id). Pinning that order does not
      // rescue this assertion, it only makes it fail every time — the number it reads was
      // never the number this test is about.
      //
      // `pooled` is that number: what THIS source contributed this round, before the window
      // dedups across sources. Still red on the defect this test exists for — a source
      // failing used to return nil for every source, so GoodBoard pooled nothing at all.
      const goodTally = (fetched.sources ?? []).find((s) => s.label === good.label);
      expect(goodTally, `${good.label} has no tally of its own`).toBeDefined();
      expect(
        goodTally?.pooled ?? 0,
        `${good.label} reported no failure yet pooled nothing: ` +
          JSON.stringify(fetched.sources),
      ).toBeGreaterThan(0);
      expect(
        failed.find((f) => f.label === 'BadToken')?.reason ?? '',
        'the reason must carry the upstream detail the log already has',
      ).not.toBe('');
    });
});
