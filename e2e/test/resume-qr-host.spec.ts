// resume-qr-host.spec.ts —— the résumé's QR/footer URL must use the owner's CONFIGURED public_url,
// not the request origin. On sijie the footer came out as `http://app-…sslip.io/?code=…` — the
// internal Coolify host a recruiter can't reach. That specific case was bad DATA (the instance's
// public_url was left as the internal host), but this guard pins the CONTRACT so a future regression
// to `window.location.origin` / the request host can't slip through: claim with a distinctive
// public_url, commit, and assert the commit's `qr_url` (what the header QR encodes) carries exactly
// that host + ?code=. Asserted on the commit response, not a PDF footer — the footer was removed.
//
// (v1 is single-owner, so the URL is `<public_url>?code=<code>` with no /handle — by design,
// jobsuc/applications.go.) Matrix C1.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'qrhost@example.com', password: 'correct-horse-battery-staple',
  handle: 'qrhost', fullName: 'QR Host Owner',
};
// A distinctive public host that is NOT localhost and NOT the request origin — if the QR URL is
// built from the configured public_url, this appears verbatim; if it ever reverts to the origin, it
// will not.
const PUBLIC_URL = 'https://recruiter-facing.example';

test.describe('resume QR/footer uses the configured public_url', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), { ...OWNER, publicUrl: PUBLIC_URL });
    await request.dispose();
  });

  test('the commit qr_url carries <public_url>?code=, not the request host', async ({ request }) => {
    const committed = await commitResume(request);
    const qr = committed.view.qr_url;

    // Host + code query + the issued code — the builder may add a trailing slash before ?code=, so
    // assert the parts rather than an exact concatenation.
    expect(qr, 'qr_url uses the configured public host').toContain('recruiter-facing.example');
    expect(qr, 'qr_url carries the code query').toContain('?code=');
    expect(qr, 'qr_url carries the issued code').toContain(committed.view.access_code);
    // A regression to the request origin / internal host would show localhost or an sslip.io host.
    expect(qr).not.toContain('localhost');
    expect(qr).not.toContain('sslip.io');
  });
});

async function commitResume(request: APIRequestContext) {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'qrhost-pdf');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const fetched = await jobsFetchNew(request, token, sid, src.id);
  expect(fetched.jobs[0]).toBeDefined();
  const drafted = await resumeDraft(request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent());
  return applicationsCommit(request, token, sid, drafted.view.draft_id);
}
