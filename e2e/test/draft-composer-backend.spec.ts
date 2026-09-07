// draft-composer-backend.spec.ts —— the composer's write path actually persists, and the owner's
// live preview renders through the SAME renderer as the committed PDF (A3: one Puck config drives
// editor + PDF; typst is gone). This proves, end to end through the real DB + gotenberg:
//   - PATCH /drafts/{id} persists edited resume_content;
//   - GET /drafts/{id} reflects it;
//   - GET /drafts/{id}/preview.pdf renders a REAL PDF whose text layer carries the résumé content
//     — i.e. the preview the owner clicks is the same render the recruiter receives, not a blank
//     page or an error. (Before A3 this was a typst render for a picked template; the composer no
//     longer picks templates, so the `/drafts/templates` list is empty by design.)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-composer@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftcomposer', fullName: 'Draft Composer Owner',
};

let ctx: APIRequestContext;
let csrf = '';

const EDITED_CONTENT = {
  identity: {
    name: 'A Candidate', email: 'a@example.com', phone: '', location_line: 'Remote',
    site: '', links: [],
  },
  summary: 'edited summary',
  works: [], educations: [], skills: [],
  social: [{ kind: 'github', label: 'GitHub', handle: '@acand' }],
  custom: [{ label: 'Languages', value: 'English · Mandarin' }],
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · backend write + templates + preview', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('PATCH persists content; detail reflects it; preview.pdf renders the résumé', async () => {
    // a fresh manual draft
    const created = await postJSON<{ id: string }>('/drafts', {
      company: 'Acme', role: 'Engineer',
    });

    // PATCH the composer's edits: added social + custom rows
    const saved = await patchJSON<{ resume_content: typeof EDITED_CONTENT }>(
      `/drafts/${created.id}`, { resume_content: EDITED_CONTENT },
    );
    expect(saved.resume_content.social).toHaveLength(1);
    expect(saved.resume_content.custom[0]!.label).toBe('Languages');

    // reopening the draft returns the persisted edits (not the discarded original)
    const reopened = await getJSON<{ resume_content: typeof EDITED_CONTENT }>(
      `/drafts/${created.id}`,
    );
    expect(reopened.resume_content.summary, 'content persisted').toBe('edited summary');
    expect(reopened.resume_content.social[0]!.handle).toBe('@acand');

    // preview.pdf renders the SAME Puck → gotenberg pipeline as commit (A3: one renderer). It must be
    // a real PDF whose text layer carries the résumé content — proves the print route SSR'd the Puck
    // <Render> (not a blank page, not a Next error page). This is the render the recruiter receives.
    const preview = await ctx.get(`${BACKEND}/api/admin/drafts/${created.id}/preview.pdf`);
    expect(preview.status(), 'preview renders (not 500)').toBe(200);
    expect(preview.headers()['content-type']).toContain('application/pdf');
    const body = await preview.body();
    expect(body.subarray(0, 5).toString('latin1'), 'a real PDF').toBe('%PDF-');
    const info = await inspectPDF(body);
    const text = info.text.toLowerCase();
    expect(text, 'name is on the page').toContain('candidate');
    expect(text, 'summary is on the page').toContain('summary');
  });
});

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  ctx = await playwright.request.newContext();
  await claim(ctx, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(ctx, OWNER.email, OWNER.password));
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await ctx.get(`${BACKEND}/api/admin${path}`, { headers: { 'X-Csrftoken': csrf } });
  expect(res.status(), `GET ${path}`).toBe(200);
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, data: unknown): Promise<T> {
  const res = await ctx.post(`${BACKEND}/api/admin${path}`, {
    headers: { 'X-Csrftoken': csrf }, data,
  });
  expect(res.status(), `POST ${path}`).toBeLessThan(300);
  return res.json() as Promise<T>;
}

async function patchJSON<T>(path: string, data: unknown): Promise<T> {
  const res = await ctx.patch(`${BACKEND}/api/admin${path}`, {
    headers: { 'X-Csrftoken': csrf }, data,
  });
  expect(res.status(), `PATCH ${path}`).toBe(200);
  return res.json() as Promise<T>;
}
