// resume-pdf-content.spec.ts —— deeper PDF assertions beyond `%PDF-` magic:
//   1. Text extraction works → PDF is NOT image-only (ATS friendly)
//   2. PDF text contains resume identity / company / role / project content
//   3. After commit, embedded QR decodes to the documented qr_url
//
// These guard the recruiter loop: if PDF is image-only or QR is broken,
// the visitor-chat closeback in applications-commit-qr-works would still
// "pass" but recruiters can't actually scan/parse the artifact.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, applicationsCommit, sampleResumeContent } from '@/fixtures/resume';
import { extractPDFText, extractFirstQR } from '@/fixtures/pdf-inspect';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('resume PDF content (text layer + QR encoding)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('draft PDF: ATS-friendly text layer with identity + work + project content',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'pdf-content-draft');
      const sid = await initMCP(request, token);
      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const firstJob = fetched.jobs[0];
      expect(firstJob).toBeDefined();

      const content = sampleResumeContent();
      const drafted = await resumeDraft(request, token, sid, firstJob!.cache_id, content);

      // The PDF must have a real text layer (pdf-parse extracts > 0 chars).
      // Image-only PDFs return empty / whitespace-only text.
      const { text, pages } = await extractPDFText(drafted.pdf);
      expect(pages).toBeGreaterThan(0);
      expect(text.trim().length).toBeGreaterThan(50);

      // The text layer contains the actual resume content (proving ATS systems
      // can parse it). Spot-check each major section.
      expect(text).toContain(content.identity.name);
      expect(text).toContain(content.identity.email);
      expect(text).toContain(content.summary);
      expect(text).toContain(content.works[0]!.company);
      expect(text).toContain(content.works[0]!.title);
      expect(text).toContain(content.works[0]!.bullets[0]!);
      expect(text).toContain(content.projects[0]!.name);
      expect(text).toContain(content.educations[0]!.school);
      expect(text).toContain(content.skills[0]!.items[0]!);
    });

  test('committed PDF: embedded QR decodes to the published qr_url',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'pdf-content-commit');
      const sid = await initMCP(request, token);
      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const firstJob = fetched.jobs[0];
      expect(firstJob).toBeDefined();

      const drafted = await resumeDraft(request, token, sid, firstJob!.cache_id, sampleResumeContent());
      const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);

      // Final PDF text layer also holds resume content (sanity).
      const { text } = await extractPDFText(committed.pdf);
      expect(text).toContain('Alice Anderson');

      // The QR image embedded in the PDF must decode to the documented qr_url.
      // qr_url shape: <public_url>/?code=<access_code>
      const decoded = await extractFirstQR(committed.pdf);
      expect(decoded).not.toBeNull();
      expect(decoded).toBe(committed.view.qr_url);
      // And the code embedded in that URL is the same plaintext access_code.
      expect(decoded).toContain(committed.view.access_code);
    });
});
