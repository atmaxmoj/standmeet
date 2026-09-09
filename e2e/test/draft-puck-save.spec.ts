// draft-puck-save.spec.ts —— the Puck editor's Save persists the résumé to its SINGLE canonical
// source (resume_content), and reopening the editor shows it.
//
// Before the single-source change this asserted Save wrote a separate puck_data copy. That copy is
// gone: resume_content is the one source, and the editor re-derives its Puck document from it on
// open (a stored puck_data that had drifted used to blank the editor — see resume-single-source).
//
// Proven through the REAL UI + DB, POSITIVE assertions:
//   - the editor opens showing the seeded resume_content (derived);
//   - clicking Save keeps resume_content intact in the DB (the Save button reaches the canonical source);
//   - reopening the editor still shows that content (loaded from resume_content, no puck_data needed).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-save@example.com', password: 'correct-horse-battery-staple',
  handle: 'pucksave', fullName: 'Puck Save Owner',
};

const NAME = 'Sijie Wang';
const NAME_SHOWN = new RegExp(NAME, 'i'); // the résumé displays the name lowercase

interface DraftDetail { resume_content?: { identity?: { name?: string } } }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Puck résumé editor · Save persists resume_content (single source)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('editor opens with resume_content; Save keeps it; reopening still shows it',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);

      // Open the composer via click-nav (drafts → open composer).
      await openComposer(page, id);
      const canvas = page.frameLocator('iframe').first();
      await expect(canvas.locator('[data-sec="header"]'), 'editor opens showing resume_content')
        .toContainText(NAME_SHOWN, { timeout: 30_000 });

      // Click Save → resume_content stays intact in the DB (the Save button reaches the canonical source).
      await clickSave(page);
      await expect.poll(async () => (await getDraft(api, id)).resume_content?.identity?.name, {
        message: 'Save keeps resume_content in the canonical store', timeout: 20_000,
      }).toBe(NAME);

      // Reopen: the editor still shows the content (loaded from resume_content).
      await openComposer(page, id);
      await expect(page.frameLocator('iframe').first().locator('[data-sec="header"]'),
        'reopened editor still shows resume_content').toContainText(NAME_SHOWN, { timeout: 30_000 });
      await api.dispose();
    });
});

// openComposer —— reach the full-page editor the way the owner does: drafts nav → the draft's
// "open composer" button. (adminPage lands on /admin.)
async function openComposer(page: Page, id: string): Promise<void> {
  await page.getByTestId('admin-nav-drafts').click();
  const open = page.getByTestId(`draft-open-${id}`);
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
}

async function clickSave(page: Page): Promise<void> {
  const save = page.getByTestId('puck-save');
  await expect(save, 'the Puck editor shows a Save action').toBeVisible({ timeout: 15_000 });
  await save.click();
}

async function getDraft(api: APIRequestContext, id: string): Promise<DraftDetail> {
  const res = await api.get(`${BACKEND}/api/admin/drafts/${id}`);
  expect(res.status(), 'GET draft').toBe(200);
  return res.json() as Promise<DraftDetail>;
}

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Northwind', role: 'Staff Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: {
      name: NAME, email: 'sijie@example.com', phone: '+1 555 0142',
      location_line: 'Hamilton, ON', site: 'sijie.xyz', links: [],
    },
    summary: 'Backend engineer who builds trustworthy natural-language software.',
    works: [{
      company: 'Northwind Logistics', title: 'Senior Backend Engineer', location: 'Remote',
      period: { start: '2021-03', end: null },
      bullets: ['Owned the dispatch pipeline.'],
    }],
    educations: [], skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
    social: [], custom: [], accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
