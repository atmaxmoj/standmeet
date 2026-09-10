// Q0 Group D: editing a SECTION field (the Header's Name) in the real Puck editor reaches
// resume_content — the counterpart to draft-puck-field-edit, which only drove the always-visible
// ROOT fields. Selecting a component on the canvas is dnd-kit-flaky on the first synthetic click, so
// the click-to-select is hardened with a toPass retry (the pattern proven in composer-code-picker),
// not a rerun for green.
//
// RED-reachability: if the panel edit didn't flow through Save into resume_content, the polled name
// stays OLD_NAME and the assertion fails.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'section-edit@example.com', password: 'correct-horse-battery-staple',
  handle: 'sectionedit', fullName: 'Section Edit Owner',
};
const OLD_NAME = 'Original Name';
const NEW_NAME = 'Zoltar Vega renamed in the Header panel';

interface Detail { resume_content: { identity?: { name?: string } } }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Puck section-field edit reaches resume_content (Q0 D)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('editing the Header Name in its field panel → Save → resume_content.identity.name',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);
      expect((await getDetail(api, id)).resume_content.identity?.name).toBe(OLD_NAME);

      await goto(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      // Select the Header on the canvas → its field panel (with the Name field) opens. dnd-kit can
      // drop the first synthetic click, so retry click+assert until the panel opens.
      const canvas = page.frameLocator('iframe').first();
      await expect(async () => {
        await canvas.locator('[data-sec="header"]').first().click();
        await expect(page.getByLabel('Name')).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });

      await page.getByLabel('Name').fill(NEW_NAME);
      await page.getByTestId('puck-save').click();

      await expect.poll(async () => (await getDetail(api, id)).resume_content.identity?.name,
        { message: 'the edited Header name must reach resume_content', timeout: 15_000 })
        .toBe(NEW_NAME);
      await api.dispose();
    });
});

async function getDetail(api: APIRequestContext, id: string): Promise<Detail> {
  const res = await api.get(`${BACKEND}/api/admin/drafts/${id}`);
  expect(res.status(), 'GET draft').toBe(200);
  return res.json() as Promise<Detail>;
}

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: OLD_NAME, email: 'r@ex.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'a summary', works: [], educations: [], skills: [], social: [], custom: [],
    cover_letter: '', accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
