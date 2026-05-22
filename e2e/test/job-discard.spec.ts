// job-discard.spec.ts —— owner can drop a single job from the cache pool
// via jobs.discard. Subsequent jobs.show on that cache_id returns cache-miss.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  jobsDiscard, jobsFetchNew, jobsRegisterSource, jobsShow,
} from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('jobs.discard removes a cached job', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('discard → show returns cache miss',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'discard-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const cacheID = fetched.jobs[0]?.cache_id;
      expect(cacheID).toBeDefined();

      const discard = await jobsDiscard(request, token, sid, cacheID!);
      expect(discard.ok).toBe(true);

      await expect(
        jobsShow(request, token, sid, cacheID!),
      ).rejects.toThrow(/cache miss/i);
    });
});
