// resume-draft-ttl.spec.ts —— resume_drafts has a 1d TTL via expires_at column.
// Push expires_at into the past via psql, then update_draft must return
// "draft not found" (the GetResumeDraft / UpdateResumeDraftContent queries
// both filter `expires_at > now()`).
//
// Same shape as job-fetch-ttl-eviction but for postgres-side TTL instead of
// Redis-side. Verifies the contract without sleeping 24h.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, resumeUpdateDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const DB_CONTAINER = 'standmeet-dev-db-1';

test.describe('resume_drafts 1d TTL — expired row is invisible', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('expired draft → update_draft returns draft-not-found',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'resume-ttl-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const job = fetched.jobs[0]!;
      const drafted = await resumeDraft(
        request, token, sid, job.cache_id, sampleResumeContent(),
      );

      // Sanity: update works before expiry.
      const stillFresh = await resumeUpdateDraft(
        request, token, sid, drafted.view.draft_id, sampleResumeContent(),
      );
      expect(stillFresh.view.draft_id).toBe(drafted.view.draft_id);

      // Force-expire by pushing expires_at one hour into the past.
      forceExpireDraft(drafted.view.draft_id);

      await expect(
        resumeUpdateDraft(request, token, sid, drafted.view.draft_id, sampleResumeContent()),
      ).rejects.toThrow(/draft not found/i);
    });
});

function forceExpireDraft(draftID: string): void {
  const sql =
    `UPDATE resume_drafts SET expires_at = now() - interval '1 hour' WHERE id = '${draftID}'`;
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  );
}
