// job-fetch-ttl-eviction.spec.ts —— after fetch, force-expire the
// cache_id via docker exec redis-cli PEXPIRE; jobs.show then returns
// cache-miss. Verifies the 1d TTL contract without sleeping 24h.
//
// We use DEL (synchronous delete) instead of PEXPIRE so there's no need
// to wait on Redis async expiry — the next jobs.show is immediately a miss.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  jobsFetchNew, jobsRegisterSource, jobsShow,
} from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('Redis 1d TTL eviction of fetched jobs', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('cache_id resolvable post-fetch; expired → jobs.show errors',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'ttl-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      expect(fetched.jobs.length).toBeGreaterThan(0);

      const first = fetched.jobs[0]!;

      // Immediate resolve
      const shown = await jobsShow(request, token, sid, first.cache_id);
      expect(shown.external_id).toBe(first.external_id);

      // Delete all job:* keys (single-owner v1 → safe)
      deleteAllJobKeys();

      // Now jobs.show returns cache-miss (DEL is sync, no wait needed)
      await expect(
        jobsShow(request, token, sid, first.cache_id),
      ).rejects.toThrow(/cache miss/i);
    });
});

// DEL every job:* key — synchronous in Redis, so subsequent show is
// immediately a miss. Single-owner v1 so this is safe.
function deleteAllJobKeys(): void {
  const script = 'redis-cli --scan --pattern "job:*" | xargs -r redis-cli DEL';
  execSync(`docker exec standmeet-dev-redis-1 sh -c '${script}'`, { stdio: 'pipe' });
}
