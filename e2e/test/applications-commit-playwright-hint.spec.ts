// applications-commit-playwright-hint.spec.ts —— Phase 4 contract.
//
// We don't add a separate "submit" MCP tool because the Playwright MCP is
// owner-installed and lives outside StandMeet. Instead, the commit response
// embeds a structured `next_action` hint Claude can read to drive the local
// Playwright MCP: it carries the target_url (job posting), an attachment_uri
// pointing back at the PDF embedded in the same response, identity fields
// pre-extracted from resume_content for form-fill, and prose instructions.

import { test, expect } from '@/fixtures/test';

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

test.describe('applications.commit embeds Playwright submission hint', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('next_action carries target_url, attachment_uri, fill_fields, instructions',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'playwright-hint-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const job = fetched.jobs[0]!;

      const drafted = await resumeDraft(
        request, token, sid, job.cache_id,
        sampleResumeContent({
          identity: {
            name: 'Alice Anderson', email: 'alice@example.com',
            phone: '+1 415 555 0100', location_line: 'San Francisco, CA',
            links: [],
          },
        }),
      );
      const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);

      const hint = committed.view.next_action;

      expect(hint.type).toBe('submit_via_playwright');
      expect(hint.target_url).toBe(job.url);
      expect(hint.attachment_uri).toBe(
        `standmeet://application/${committed.view.application_id}`,
      );

      // identity fields propagated → Playwright form fill
      expect(hint.fill_fields).toEqual({
        name: 'Alice Anderson',
        email: 'alice@example.com',
        phone: '+1 415 555 0100',
        location: 'San Francisco, CA',
      });

      // prose instructions explicit about Playwright + PDF attachment + QR
      expect(hint.instructions.toLowerCase()).toContain('playwright');
      expect(hint.instructions.toLowerCase()).toContain('attachment_uri');
      expect(hint.instructions.toLowerCase()).toContain('qr');
    });
});
