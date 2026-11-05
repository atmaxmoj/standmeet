// application-pdf-download.spec.ts —— 下载口子 spec: a committed application's final PDF downloads on
// demand from both faces, re-rendered from the stored row (never stored). Black-box:
//   - agent face: MCP applications.resume_pdf → an embedded PDF resource
//   - GUI face: GET /api/admin/applications/{id}/resume.pdf, and the detail-modal button that hits it
//   - pure read: the application and its code are unchanged after downloading
//   - idempotent: a second download is still the same PDF
//   - unknown id → a clear not-found, not a blank file
//
// The PDF appeared once in applications.commit's result and nothing stores it; this proves it is
// reproducible from the row (resume_content + job_snapshot + the plaintext access code for the QR).

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import {
  callToolMulti, callToolOutcome, initMCP, type MCPContent,
} from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// A well-formed UUID that was never committed → the not-found path, not a parse error.
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Seeded once in beforeAll; both tests read it.
let appID = '';
let accessCode = '';

function pdfOf(parts: MCPContent[]): Buffer {
  const res = parts.find((p) => p.type === 'resource');
  if (!res || res.type !== 'resource') {
    throw new Error('applications.resume_pdf: missing embedded PDF resource');
  }
  return Buffer.from(res.resource.blob, 'base64');
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('a committed application re-renders its PDF on demand (下载口子)', () => {
  test.beforeAll(async ({ playwright }) => { await seedCommit(playwright); });

  test('both faces return the committed PDF; pure read; unknown id → not found',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'pdf-dl-spec');
      const sid = await initMCP(request, token);

      // agent face: applications.resume_pdf → an embedded PDF.
      const agentPDF = pdfOf(
        await callToolMulti(request, token, sid, 'applications.resume_pdf', {
          application_id: appID,
        }),
      );
      expect(agentPDF.subarray(0, 5).toString()).toBe('%PDF-');
      expect(agentPDF.length).toBeGreaterThan(1000);

      // GUI face: the admin route the detail-modal button hits (cookie-authed by loginAPI).
      const res = await request.get(`${BACKEND}/api/admin/applications/${appID}/resume.pdf`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/pdf');
      const adminPDF = Buffer.from(await res.body());
      expect(adminPDF.subarray(0, 5).toString()).toBe('%PDF-');

      // idempotent: a second download is still a PDF, comparable in size (same content re-rendered).
      const res2 = await request.get(`${BACKEND}/api/admin/applications/${appID}/resume.pdf`);
      const adminPDF2 = Buffer.from(await res2.body());
      expect(adminPDF2.subarray(0, 5).toString()).toBe('%PDF-');
      expect(Math.abs(adminPDF2.length - adminPDF.length)).toBeLessThan(adminPDF.length * 0.2);

      // pure read: the application still exists and its code still opens a visitor session — no new
      // row, no new code, the original code's grant untouched.
      const detail = await request.get(`${BACKEND}/api/admin/applications/${appID}`);
      expect(detail.status()).toBe(200);
      const session = await request.post(`${BACKEND}/api/v1/sessions`, {
        headers: { 'Content-Type': 'application/json' },
        data: { mode: 'code', code: accessCode, visitor_name: 'Recruiter Bob' },
      });
      expect(session.status()).toBe(200);

      // unknown id → a clear not-found on both faces, not a blank file.
      const miss = await request.get(`${BACKEND}/api/admin/applications/${MISSING_ID}/resume.pdf`);
      expect(miss.status()).toBe(404);
      const missOutcome = await callToolOutcome(request, token, sid, 'applications.resume_pdf', {
        application_id: MISSING_ID,
      });
      expect(missOutcome.reachable).toBe(true);
      expect(missOutcome.isError).toBe(true);
    });

  test('the detail-modal download button is enabled and downloads the PDF',
    async ({ adminPage }) => {
      await openApplications(adminPage);
      await adminPage.getByTestId(`application-row-${appID}`).getByRole('button').first().click();
      await expect(adminPage.getByTestId('application-detail-modal')).toBeVisible();

      const dl = adminPage.getByTestId('application-download-pdf');
      await expect(dl).toBeVisible();
      await expect(dl).toHaveAttribute('href', `/api/admin/applications/${appID}/resume.pdf`);

      const downloadPromise = adminPage.waitForEvent('download', { timeout: 30_000 });
      await dl.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('.pdf');
    });
});

async function seedCommit(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pdf-dl-seed');
  const sid = await initMCP(request, token);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  const drafted = await resumeDraft(
    request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent(),
  );
  const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);
  appID = committed.view.application_id;
  accessCode = committed.view.access_code;
  await request.dispose();
}

async function openApplications(page: Page): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await page.waitForURL('**/admin/applications');
}
