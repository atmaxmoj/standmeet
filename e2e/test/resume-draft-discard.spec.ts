// resume-draft-discard.spec.ts —— after discard, a subsequent update_draft
// on the same draft_id returns "draft not found". Also asserts discard is
// idempotent (second discard returns ok:true, never throws).

import { test, expect } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  resumeDraft, resumeDiscardDraft, resumeUpdateDraft, sampleResumeContent,
} from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('resume.discard_draft removes the row', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('discard → update returns draft-not-found; second discard is ok',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'resume-discard-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const job = fetched.jobs[0]!;
      const drafted = await resumeDraft(
        request, token, sid, job.cache_id, sampleResumeContent(),
      );

      const firstDiscard = await resumeDiscardDraft(request, token, sid, drafted.view.draft_id);
      expect(firstDiscard.ok).toBe(true);

      await expect(
        resumeUpdateDraft(request, token, sid, drafted.view.draft_id, sampleResumeContent()),
      ).rejects.toThrow(/draft not found/i);

      // Idempotent: discarding again still returns ok:true.
      const secondDiscard = await resumeDiscardDraft(request, token, sid, drafted.view.draft_id);
      expect(secondDiscard.ok).toBe(true);
    });
});
