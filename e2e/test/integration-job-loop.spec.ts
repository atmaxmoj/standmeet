// integration-job-loop.spec.ts —— job loop end-to-end:
// register source → fetch → resume.draft → applications.commit →
// auto code issued → QR on PDF → recruiter scans → ChatRoom.
//
// User story:
//   register source → fetch_new → listings indexed → resume.draft →
//   applications.commit → auto code issued → QR on PDF →
//   recruiter scans the QR → ChatRoom → owner reads the transcript in conversations

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection, enterCodeSession } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { issueSession } from '@/fixtures/visitor';

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
      await enterCodeSession(page, accessCode);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });

  test('owner sees the application in admin',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      // application row testid is `application-row-{id}`; just check at least one exists
      await expect(adminPage.locator('[data-testid^="application-row-"]').first())
        .toBeVisible({ timeout: 5_000 });
    });

  // #126: the recruiter enters via the app-code; the agent persona must carry which application
  // (job identity) so the AI answers as the candidate for that specific role. The job-loop wrote a
  // recruiter briefing into the app-code's inline_prompt at commit (#104 extension); the session core
  // injects it agnostically as the per-code persona segment.
  test('recruiter session persona carries the application context (#126)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const session = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: accessCode,
        visitor_name: 'Recruiter', visitor_email: 'recruiter@example.com',
      });
      const persona = session.system_prompt_persona ?? '';
      // The briefing is injected as the per-code persona segment (job-loop wrote it at commit).
      expect(persona, 'agent knows it is talking to a recruiter about an application')
        .toContain('recruiter who received your job application');
      // …and it names the specific job (greenhouse airbnb board → company Airbnb).
      expect(persona, 'the persona names which application (job identity)').toContain('Airbnb');
      await request.dispose();
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
