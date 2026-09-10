// composer-code-picker.spec.ts —— the résumé composer's access-code picker lives in the Puck HEADER
// component's field panel (the QR is a Header element — owner: "码是在 header 里面的"), NOT in a top
// action bar. Selecting the Header on the canvas opens its field panel (name / email / … + the
// picker); until then no picker is on screen — proving it moved off the always-visible bar. It is
// still ALWAYS present once the Header is selected, even with no active codes (owner: "no active
// codes 和有没有 picker 有什么关系") — then a single placeholder option.
//
// The selection is composer state (it drives SEND + the QR preview), not résumé content, so it is
// wired through ComposerCodeContext and never written into resume_content.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { openReader } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'codepicker@example.com', password: 'correct-horse-battery-staple',
  handle: 'codepicker', fullName: 'Code Picker Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé composer code picker lives in the Header field panel', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the code picker is in the Header field panel (not the top bar), present even with no codes',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api: APIRequestContext = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);

      await openReader(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      // Not on the always-visible action bar: before the Header is selected there is no code picker on
      // screen (it moved into the Header's field panel).
      await expect(page.getByTestId('composer-code-select'),
        'the code picker is not in the top action bar').toHaveCount(0);

      // Select the Header component on the canvas → its field panel opens. Puck's iframe canvas can
      // drop the first click-to-select (dnd-kit), so retry the click until the panel actually opens
      // (the Name field appears) — this hardens the interaction, it is not a rerun for green.
      const canvas = page.frameLocator('iframe').first();
      await expect(async () => {
        await canvas.locator('[data-sec="header"]').first().click();
        await expect(page.getByLabel('Name')).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });

      // The picker now shows, in the Header field panel, alongside the Header's own fields.
      await expect(page.getByTestId('composer-code-select'),
        'the code picker is in the Header field panel').toBeVisible();
      // With no active codes it is still present — a single placeholder option (SEND still auto-issues
      // a fresh code when none is picked).
      await expect(page.getByTestId('composer-code-empty'), 'placeholder option present').toHaveCount(1);
      await api.dispose();
    });
});

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  // Identity present so the Header renders a clickable block on the canvas.
  const resume_content = {
    identity: { name: 'Cand', email: 'c@ex.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'hi', works: [], educations: [], skills: [], social: [], custom: [], accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
