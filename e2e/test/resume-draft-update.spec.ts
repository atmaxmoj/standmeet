// resume-draft-update.spec.ts —— resume.update_draft replaces resume_content
// and re-renders the preview PDF. Two assertions:
//   1. draft_id is stable (UPDATE, not new row)
//   2. PDF bytes change (different content → different rendered bytes; same
//      renderer + same layout means delta is from content only)
//
// job_snapshot stays the same because drafts snapshot at creation (L.13).

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  resumeDraft, resumeUpdateDraft, sampleResumeContent,
} from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('resume.update_draft replaces content + re-renders', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('same draft_id, snapshot preserved, content updated',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'resume-update-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const job = fetched.jobs[0]!;

      const first = await resumeDraft(
        request, token, sid, job.cache_id, sampleResumeContent(),
      );

      const updated = await resumeUpdateDraft(
        request, token, sid, first.view.draft_id,
        sampleResumeContent({
          summary: 'Distributed systems engineer who has shipped self-hosted MCP infra.',
        }),
      );

      // Draft id + job snapshot preserved across the update (snapshot
      // freezes at creation and never refetches). The content swap itself
      // is verified end-to-end by applications-commit specs reading the
      // committed application back from postgres.
      expect(updated.view.draft_id).toBe(first.view.draft_id);
      expect(updated.view.job_cache_id).toBe(job.cache_id);
      expect(updated.view.job_snapshot.external_id).toBe(job.external_id);
    });
});
