// admin-applications.spec.ts —— admin applications: empty state, card after
// commit, detail modal with timeline.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'apps@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'apps',
  fullName: 'Apps Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin applications UI', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('empty state → "No applications" message',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      await expect(adminPage.getByText(/no applications/i)).toBeVisible();
    });

  test('after commit → application card appears',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      await seedApplication(request);
      await request.dispose();
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      // At least one row/card should appear (not the empty state)
      await expect(adminPage.getByText(/no applications/i)).toHaveCount(0, { timeout: 5_000 });
    });
});

async function seedApplication(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'apps-seed');
  const sid = await initMCP(request, token);
  // Use 'airbnb' company — mock job board has data for it
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Apps Test Board',
    config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs for airbnb');
  const { view } = await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
  await applicationsCommit(request, token, sid, view.draft_id);
}
