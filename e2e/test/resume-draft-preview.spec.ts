// resume-draft-preview.spec.ts —— owner uses Claude to tailor a resume for
// a job in the cache pool; MCP resume.draft returns the structured draft
// view (draft_id + job_snapshot + resume_content). Preview rendering lives
// in the admin browser (React `ResumePage`), and the final recruiter PDF
// is rendered by gotenberg at applications.commit time — neither flows
// through this tool. We assert here that the JSON view round-trips the
// cached job snapshot so the AI client can carry it forward without a
// second fetch.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('resume.draft returns a structured snapshot view', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('draft returns structured view echoing the job snapshot',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'resume-preview-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const firstJob = fetched.jobs[0];
      expect(firstJob).toBeDefined();

      const drafted = await resumeDraft(
        request, token, sid, firstJob!.cache_id, sampleResumeContent(),
      );

      // Structured view echoes job snapshot so Claude can carry it forward
      // without a second fetch_new round-trip.
      expect(drafted.view.draft_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(drafted.view.job_cache_id).toBe(firstJob!.cache_id);
      expect(drafted.view.job_snapshot.external_id).toBe(firstJob!.external_id);
      expect(drafted.view.job_snapshot.title).toBe(firstJob!.title);
    });
});
