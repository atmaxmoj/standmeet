// admin-applications.spec.ts —— admin applications UI: card, detail modal,
// timeline, status segmented, notes, empty state.
//
// 用户故事：
//   1. application card → 3-col footer (contact / notes / "open ›")
//   2. click card → ApplicationDetailModal opens
//   3. modal → timeline renders (sent → opened → reviewing)
//   4. modal → status segmented toggle
//   5. modal → notes textarea editable
//   6. empty state → "No applications sent yet."

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

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
    await initOwner(playwright);
  });

  test('empty state → "No applications" message',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      await expect(adminPage.getByText(/no applications/i)).toBeVisible();
    });

  test('after commit → application card appears',
    async ({ request, adminPage }) => {
      await seedApplication(request);
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      await expect(adminPage.getByTestId('application-card')).toBeVisible({ timeout: 5_000 });
    });

  test('click card → detail modal opens with timeline',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      const card = adminPage.getByTestId('application-card').first();
      await card.click();
      const modal = adminPage.getByTestId('application-detail-modal');
      await expect(modal).toBeVisible({ timeout: 5_000 });
      // Timeline should render
      await expect(modal.getByTestId('application-timeline')).toBeVisible();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function seedApplication(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'apps-seed');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Apps Test Board',
    config: { company: 'standmeet' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length > 0) {
    const { view } = await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
    await applicationsCommit(request, token, sid, view.draft_id);
  }
}
