// admin-system-jobs.spec.ts —— Monitor/observability。SystemSection 的 background-jobs 表接真
// GET /api/admin/stats/jobs:进程内 job-registry,真 cron(沙箱 workspace sweep #148、resume-draft
// SweepExpired)上报 last-run/status。RED 直到端点落地(现在 404)。绿=列真 job,**删掉**硬编的
// sitemap/corpus-reindex/daily-backup(它们根本不存在,列它们又是造假)。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'alice@example.com', password: 'test-password-1234',
  handle: 'alice', fullName: 'Alice',
};

interface Jobs {
  jobs: { name: string; schedule: string; last_run: string | null; last_status: string }[];
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · SystemSection real scheduled jobs', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    // Force one real cron run so its last_run is fresh + deterministic.
    await request.post(`${BACKEND}/internal/diag/sandbox/sweep`).catch(() => undefined);
    await request.dispose();
  });

  test('GET /api/admin/stats/jobs lists the real crons, ran, with status — no fake rows',
    async ({ adminPage }) => {
      const res = await adminPage.request.get(`${BACKEND}/api/admin/stats/jobs`);
      expect(res.status(), 'jobs endpoint 200').toBe(200);
      const { jobs } = await res.json() as Jobs;

      expect(jobs.length, 'at least the sandbox sweep job').toBeGreaterThan(0);
      const sweep = jobs.find((j) => /sandbox|workspace/i.test(j.name));
      expect(sweep, 'sandbox workspace sweep is a registered real job').toBeTruthy();
      expect(sweep?.schedule, 'has a real schedule').toBeTruthy();
      expect(sweep?.last_run, 'ran at least once (we triggered it)').toBeTruthy();
      expect(sweep?.last_status, 'reports a status').toBeTruthy();

      // The old hardcoded fake jobs must be gone.
      const names = jobs.map((j) => j.name.toLowerCase()).join(' | ');
      expect(names, 'no fake sitemap/backup/reindex rows').not.toMatch(
        /sitemap|daily backup|corpus reindex/,
      );
    });
});
