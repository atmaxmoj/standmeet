// applications-commit-qr-works.spec.ts —— the recruiter-side closing of the
// loop. After commit, the recruiter visits `<owner>/?code=<access_code>` and
// the front-end calls POST /api/v1/sessions with tier='code'. We exercise
// exactly that path with the freshly issued plaintext and assert it returns a
// valid visitor session — proving the QR-encoded code actually opens chat.

import { test, expect } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  applicationsCommit, resumeDraft, sampleResumeContent,
} from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.describe.serial('applications.commit issues an access code recruiters can use', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('issued access code opens a visitor session via POST /api/v1/sessions',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'qr-works-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const drafted = await resumeDraft(
        request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent(),
      );
      const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);

      // Recruiter front-end path: POST /api/v1/sessions tier='code' with the
      // plaintext from the QR. Returns a session_token if the code is valid.
      const res = await request.post(`${BACKEND}/api/v1/sessions`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          tier: 'code',
          handle: OWNER.handle,
          code: committed.view.access_code,
          visitor_name: 'Recruiter Bob',
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(typeof body.session_token).toBe('string');
      expect(body.session_token.length).toBeGreaterThan(20);
      expect(body.owner_handle).toBe(OWNER.handle);
    });
});
