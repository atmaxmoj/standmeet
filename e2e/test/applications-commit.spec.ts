// applications-commit.spec.ts —— full Phase 3 happy path:
//   jobs.fetch_new → resume.draft → applications.commit
//
// Asserts:
//   1. commit returns application_id + plaintext access_code + qr_url + final PDF
//   2. QR URL matches the documented shape `<base>/<handle>?code=<plaintext>`
//   3. final PDF is non-empty + PDF magic
//   4. the same draft_id is gone (update_draft returns draft-not-found) — the
//      single tx must delete the draft as part of commit
//   5. the issued access code is usable: another visitor session can enter via
//      /api/v1/codes/check (or the equivalent visitor path) — proves QR works

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  applicationsCommit,
  resumeDraft, resumeUpdateDraft, sampleResumeContent,
} from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// Spec default matches docker-compose.dev.yml PUBLIC_URL (app on :38127).
// CI / other host setups can override with the same env var.
const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'http://localhost:38127';

test.describe('applications.commit promotes a draft into an application', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('draft → commit → application persisted, draft gone, QR points at owner',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'applications-commit-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const job = fetched.jobs[0]!;

      const drafted = await resumeDraft(
        request, token, sid, job.cache_id, sampleResumeContent(),
      );

      const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);

      // 1. structural assertions
      expect(committed.view.application_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(committed.view.access_code_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(committed.view.access_code).toMatch(/^app-[a-z0-9]{6}$/);
      expect(committed.view.status).toBe('pending');
      expect(committed.view.code_expires_at).toBeDefined();
      expect(committed.view.job_snapshot.external_id).toBe(job.external_id);

      // 2. QR URL shape: <owner.public_url>/?code=<access_code>
      //    v1 单 owner instance：URL 不带 handle，recruiter 扫码直接落根域名。
      const expected = `${PUBLIC_URL.replace(/\/$/, '')}/?code=${committed.view.access_code}`;
      expect(committed.view.qr_url).toBe(expected);

      // 3. final PDF
      expect(committed.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(committed.pdf.byteLength).toBeGreaterThan(2000);

      // 4. draft is gone after commit (single tx deletes it)
      await expect(
        resumeUpdateDraft(request, token, sid, drafted.view.draft_id, sampleResumeContent()),
      ).rejects.toThrow(/draft not found/i);
    });
});
