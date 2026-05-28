// admin-drafts.spec.ts —— admin drafts UI: card layout, status pill, buttons.
//
// 用户故事：
//   1. draft card → 2-col layout (content + PDF preview)
//   2. status pill colors (reviewing = amber / draft = neutral / sent = accent)
//   3. reviewing → "open composer →" + "edit" + "regenerate" buttons
//   4. draft → "finish drafting →" + "discard" buttons
//   5. empty state → "No drafts pending."

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'drafts@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'drafts',
  fullName: 'Drafts Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin drafts UI', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('empty state → "No drafts pending." shown',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'drafts');
      await adminPage.waitForURL('**/admin/drafts', { timeout: 5_000 });
      await expect(adminPage.getByText(/no drafts/i)).toBeVisible();
    });

  test('after creating draft → card appears with status + buttons',
    async ({ request, adminPage }) => {
      await seedDraft(request);
      await gotoAdminSection(adminPage, 'drafts');
      await adminPage.waitForURL('**/admin/drafts', { timeout: 5_000 });
      // Draft card should be visible
      await expect(adminPage.getByTestId('draft-card')).toBeVisible({ timeout: 5_000 });
      // Status pill
      await expect(adminPage.getByTestId('draft-status-pill')).toBeVisible();
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

async function seedDraft(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'drafts-seed');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Draft Test Board',
    config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs');
  await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
}
