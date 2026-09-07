// draft-puck-data-persist.spec.ts —— Q0 Group C (upgrade path): the résumé draft persists the Puck
// editor's own state (puck_data) alongside the canonical resume_content, and old rows open fine.
// docs/design/resume-composer-puck.md — owner: "puck 自己的 redux,点 save 就 save".
//
// resume_content stays the canonical render source; puck_data is editor fidelity, passed through the
// backend VERBATIM (the backend never interprets it). This proves, end to end through the real DB:
//   - C1 old row opens: a draft created without the Puck editor (POST /drafts, i.e. a pre-Puck /
//     agent-created row) has NO puck_data — it opens fine, the editor derives it from resume_content.
//   - round-trip: Saving a puck_data blob returns that EXACT blob on reopen (verbatim, nested intact).
//   - C2 no-op save is lossless: Saving again with the same content leaves resume_content unchanged.
//
// RED-reachability: if the backend dropped puck_data (didn't persist / didn't return it), the
// round-trip deep-equal fails; if a Save mangled resume_content, C2 fails.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-puck@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftpuck', fullName: 'Draft Puck Owner',
};

let ctx: APIRequestContext;
let csrf = '';

const CONTENT = {
  identity: {
    name: 'Puck Candidate', email: 'p@example.com', phone: '', location_line: 'Remote',
    site: '', links: [],
  },
  summary: 'a summary that must survive a no-op save',
  works: [], educations: [], skills: [],
  social: [], custom: [],
};

// A distinctive Puck document: nested content + a root prop + a sentinel string that lives ONLY in
// puck_data. If the backend interpreted or reshaped it, the deep-equal would fail.
const PUCK_DATA = {
  root: { props: { accent: '#B5391C', leftWidth: 0.34, title: 'PUCK-SENTINEL-9F3A' } },
  content: [
    { type: 'Header', props: { id: 'Header-1', name: 'Puck Candidate' } },
    { type: 'Experience', props: { id: 'Experience-1', org: 'Acme', bullets: [{ text: 'shipped it' }] } },
    { type: 'Experience', props: { id: 'Experience-2', org: 'Globex', bullets: [] } },
  ],
  zones: {},
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume draft · puck_data persists verbatim; old rows open (Q0 upgrade path)', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('C1 old row opens without puck_data; a saved puck_data round-trips; C2 no-op save is lossless',
    async () => {
      // A manual draft = a pre-Puck row: created without the Puck editor, so no puck_data yet.
      const created = await postJSON<{ id: string }>('/drafts', { company: 'Acme', role: 'Engineer' });
      const opened = await getJSON<{ puck_data?: unknown; resume_content: typeof CONTENT }>(
        `/drafts/${created.id}`,
      );
      expect(opened.puck_data, 'C1: a pre-Puck draft opens with no puck_data (editor derives it)')
        .toBeUndefined();

      // Save the Puck editor state + the derived content together.
      const saved = await patchJSON<{ puck_data: typeof PUCK_DATA }>(`/drafts/${created.id}`, {
        resume_content: CONTENT, template: 'classic', puck_data: PUCK_DATA,
      });
      expect(saved.puck_data, 'the Save echoes the puck_data back verbatim').toEqual(PUCK_DATA);

      // Reopen: puck_data is the EXACT blob (nested content + root prop + sentinel), byte-for-byte.
      const reopened = await getJSON<{ puck_data: typeof PUCK_DATA; resume_content: typeof CONTENT }>(
        `/drafts/${created.id}`,
      );
      expect(reopened.puck_data, 'puck_data round-trips verbatim through the DB').toEqual(PUCK_DATA);
      expect(reopened.resume_content.summary, 'resume_content persisted too').toBe(CONTENT.summary);

      // C2: a no-op Save (same content) leaves resume_content equal to the original.
      await patchJSON(`/drafts/${created.id}`, {
        resume_content: CONTENT, template: 'classic', puck_data: PUCK_DATA,
      });
      const after = await getJSON<{ resume_content: typeof CONTENT }>(`/drafts/${created.id}`);
      expect(after.resume_content, 'C2: no-op save is lossless').toEqual(reopened.resume_content);
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
  const res = await ctx.post(`${BACKEND}/api/admin${path}`, { headers: { 'X-Csrftoken': csrf }, data });
  expect(res.status(), `POST ${path}`).toBeLessThan(300);
  return res.json() as Promise<T>;
}

async function patchJSON<T>(path: string, data: unknown): Promise<T> {
  const res = await ctx.patch(`${BACKEND}/api/admin${path}`, { headers: { 'X-Csrftoken': csrf }, data });
  expect(res.status(), `PATCH ${path}`).toBe(200);
  return res.json() as Promise<T>;
}
