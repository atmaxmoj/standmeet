// job-fetch-multi-source.spec.ts —— register 2 sources of different kinds;
// fetch_new with no source_id returns the union, each tagged with its
// source_kind.

import { test, expect } from '@playwright/test';

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

test.describe.serial('jobs.fetch_new across multiple registered sources', () => {
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
});
