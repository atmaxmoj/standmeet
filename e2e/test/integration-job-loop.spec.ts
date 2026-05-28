// integration-job-loop.spec.ts —— job loop end-to-end:
// register source → fetch → resume.draft → applications.commit →
// auto code issued → QR on PDF → recruiter scans → ChatRoom.
//
// 用户故事：
//   register source → fetch_new → listings indexed → resume.draft →
//   applications.commit → auto code issued → QR on PDF →
//   recruiter 扫码 → ChatRoom → owner 在 conversations 看 transcript

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'jobloop@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'jobloop',
  fullName: 'Job Loop Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('job loop end-to-end integration', () => {
  let accessCode: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const code = await runJobLoop(request);
    accessCode = code;
    await request.dispose();
  });

  test('recruiter scans QR code → lands in ChatRoom',
    async ({ page }) => {
      await goto(page, `/?code=${accessCode}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });

  test('owner sees the application in admin',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      await expect(adminPage.getByTestId('application-card')).toBeVisible({ timeout: 5_000 });
    });
});

async function runJobLoop(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'jobloop-token');
  const sid = await initMCP(request, token);
  // Seed corpus
  await seedPublicWiki(request, token, sid, {
    body: 'jobloop owner is a backend engineer.',
    title: 'JobLoop Intro',
  });
  // Register source + fetch
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Job Loop Board',
    config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('No jobs fetched');
  // Draft resume
  const { view } = await resumeDraft(
    request, token, sid, jobs[0]!.cache_id, sampleResumeContent(),
  );
  // Commit application
  const committed = await applicationsCommit(request, token, sid, view.draft_id);
  return committed.view.access_code;
}
