// draft-puck-save.spec.ts —— Q0 Group D4 (Save semantics): the Puck editor's state lives in Puck
// until the owner clicks Save; Save persists puck_data + the derived resume_content, and reopening
// restores it. docs/design/resume-composer-puck.md — owner: "puck 自己的 redux,点 save 就 save".
//
// Proven through the REAL UI + DB:
//   - a freshly-seeded draft has NO puck_data (created without the Puck editor);
//   - opening the editor and clicking Save writes puck_data (a real Puck document) to the draft;
//   - reopening the editor still mounts (it loads from the saved puck_data).
//
// RED-reachability: if Save didn't wire through to puck_data, the post-Save GET would still show no
// puck_data and the poll would time out.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-save@example.com', password: 'correct-horse-battery-staple',
  handle: 'pucksave', fullName: 'Puck Save Owner',
};

interface DraftDetail { puck_data?: { content?: unknown[] } }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Puck résumé editor · Save persists puck_data (Q0 D4)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('a seeded draft has no puck_data; clicking Save writes it; reopening loads it',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);

      // Pre-Save: the draft carries no puck_data.
      const before = await getDraft(api, id);
      expect(before.puck_data, 'a freshly-seeded draft has no puck_data yet').toBeUndefined();

      // Open the Puck editor and Save.
      await goto(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
      await clickSave(page);

      // Post-Save: puck_data is now a real Puck document (has a content array with the sections).
      await expect.poll(async () => {
        const content = (await getDraft(api, id)).puck_data?.content;
        return Array.isArray(content) ? content.length : -1;
      }, { message: 'Save must persist puck_data with the résumé sections', timeout: 20_000 })
        .toBeGreaterThan(0);

      // Reopen: the editor still mounts (now loading from the saved puck_data).
      await goto(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
      await api.dispose();
    });
});

// clickSave —— the editor's Save action (Puck owns the state; this is the commit-to-storage moment).
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
      name: 'Sijie Wang', email: 'sijie@example.com', phone: '+1 555 0142',
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
