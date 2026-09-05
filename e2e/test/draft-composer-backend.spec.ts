// draft-composer-backend.spec.ts —— the composer's write path actually persists, and the Typst
// pipeline is reachable from the panel (docs/design/resume-customization.md). Before this, the
// composer was display-only: edits were discarded at send, no template could be picked, and the
// preview was a client-side mock. This proves, end to end through the real DB + typst binary:
//   - PATCH /drafts/{id} persists edited resume_content + the chosen template;
//   - GET /drafts/{id} reflects both;
//   - GET /drafts/templates lists the Typst layouts;
//   - GET /drafts/{id}/preview.pdf renders a REAL Typst PDF for the chosen template.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

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

  test('PATCH persists content + template; detail reflects it; templates + preview work', async () => {
    // templates on offer include both Typst layouts
    const templates = await getJSON<string[]>('/drafts/templates');
    expect(templates).toEqual(expect.arrayContaining(['classic', 'compact']));

    // a fresh manual draft starts with no template chosen
    const created = await postJSON<{ id: string; template: string }>('/drafts', {
      company: 'Acme', role: 'Engineer',
    });
    expect(created.template, 'fresh draft has no template yet').toBe('');

    // PATCH the composer's edits: added social + custom rows and a template pick
    const saved = await patchJSON<{ template: string; resume_content: typeof EDITED_CONTENT }>(
      `/drafts/${created.id}`, { resume_content: EDITED_CONTENT, template: 'compact' },
    );
    expect(saved.template).toBe('compact');
    expect(saved.resume_content.social).toHaveLength(1);
    expect(saved.resume_content.custom[0]!.label).toBe('Languages');

    // reopening the draft returns the persisted edits (not the discarded original)
    const reopened = await getJSON<{ template: string; resume_content: typeof EDITED_CONTENT }>(
      `/drafts/${created.id}`,
    );
    expect(reopened.template, 'template persisted').toBe('compact');
    expect(reopened.resume_content.summary, 'content persisted').toBe('edited summary');
    expect(reopened.resume_content.social[0]!.handle).toBe('@acand');

    // the preview is a REAL Typst PDF, not a client mock
    const preview = await ctx.get(`${BACKEND}/api/admin/drafts/${created.id}/preview.pdf`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toContain('application/pdf');
    const body = await preview.body();
    expect(body.subarray(0, 5).toString('latin1'), 'a real PDF').toBe('%PDF-');
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
