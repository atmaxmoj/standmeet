// admin-system-jobs.spec.ts -- Monitor/observability. SystemSection's background-jobs table wires
// to the real GET /api/admin/stats/jobs: the in-process job-registry, real crons (sandbox
// workspace sweep #148, resume-draft SweepExpired, corpus index reconcile) report last-run/status.
// Green = lists real jobs, **removes** the hardcoded sitemap/corpus-reindex/daily-backup (they
// don't actually exist, listing them would be fabrication).
//
// The panel's flip side matters just as much: a cron that **is running but never registered**
// looks identical here to "this cron doesn't exist". The corpus reconcile loop lived like that
// for a long time -- in the hand-written ticker, the Register line was the easiest thing to
// miss. Now every periodic task goes through the same scheduler, so registration is the
// scheduler's job and can't be skipped.

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
      // We forced a run in beforeAll, so it's fresh → 'ok', NOT 'overdue'. The status is
      // now freshness-aware: a job past ~2× its interval reports 'overdue' instead of a
      // misleading green 'ok' (so "every 5m / last 6h ago" can't read as healthy). The
      // overdue derivation itself is unit-tested (TestJobHealth) — e2e can't age a job
      // deterministically without a slow/flaky wait; here we pin the fresh side.
      expect(sweep?.last_status, 'a fresh run is ok, not flagged overdue').toBe('ok');

      // resume-draft sweep is now a real registered cron too (was a method with no loop).
      const draftSweep = jobs.find((j) => /resume-draft/i.test(j.name));
      expect(draftSweep, 'resume-draft sweep registered').toBeTruthy();
      expect(draftSweep?.last_run, 'resume-draft sweep ran at boot').toBeTruthy();

      // The corpus index reconcile loop ran for its whole life WITHOUT being registered — it was a
      // hand-written ticker, and the Register call is the part a hand-written loop forgets. Every
      // periodic job now goes through one scheduler that registers it, so it cannot run unseen.
      const reconcile = jobs.find((j) => /reconcile/i.test(j.name));
      expect(reconcile, 'corpus index reconcile is on the panel').toBeTruthy();
      expect(reconcile?.last_run, 'reconcile ran at boot').toBeTruthy();

      // The schedule is DERIVED from the interval that actually fires, so it cannot drift into a
      // claim nothing checks. Every real job carries one.
      for (const j of jobs) {
        expect(j.schedule, `${j.name} states its schedule`).toMatch(/^every \d+[a-z]/);
      }

      // The old hardcoded fake jobs must be gone.
      const names = jobs.map((j) => j.name.toLowerCase()).join(' | ');
      expect(names, 'no fake sitemap/backup/reindex rows').not.toMatch(
        /sitemap|daily backup|corpus reindex/,
      );
    });
});
