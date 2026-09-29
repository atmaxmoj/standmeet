// resume-master-editor-no-send.spec.ts —— the master editor is the same Puck composer in master
// mode: a banner says it is not tied to a job; there is no SEND and no access-code picker (a master
// has no job and no code); Save writes the master. docs/design/resume-masters.md, test 6.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { contentWith, editCoverLetter, getMaster, masterCard, openDrafts, seedMaster } from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-editor@example.com', password: 'correct-horse-battery-staple',
  handle: 'mastereditor', fullName: 'Master Editor Owner',
};
const EDIT = 'SAVED-IN-MASTER-EDITOR cover letter';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · the master editor', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('banner, Save, "new draft from it" — and no SEND, no code picker; Save persists',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const m = await seedMaster(api, csrf, { name: 'General', resume_content: contentWith('EDITORSUMMARY') });

      await openDrafts(page);
      await masterCard(page, 'General').getByTestId('master-edit').click();
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      // What the master editor HAS: the banner, Save, and the way to start a draft from it.
      await expect(page.getByTestId('master-editor-banner')).toBeVisible();
      await expect(page.getByTestId('puck-save')).toBeVisible();
      await expect(page.getByTestId('master-new-draft')).toBeVisible();
      // …and what it does not: no SEND.
      await expect(page.getByTestId('composer-send')).toHaveCount(0);

      // The Header's field panel opens with its fields but no access-code picker.
      const canvas = page.frameLocator('iframe').first();
      await expect(async () => {
        await canvas.locator('[data-sec="header"]').first().click();
        await expect(page.getByLabel('Name')).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await expect(page.getByLabel('Email'), 'the Header fields are there').toBeVisible();
      await expect(page.getByTestId('composer-code-select'), 'no code picker for a master').toHaveCount(0);

      // Save writes the master.
      await editCoverLetter(page, EDIT);
      await page.getByTestId('puck-save').click();
      await expect.poll(async () => (await getMaster(api, m.id)).resume_content.cover_letter,
        { message: 'Save persists the master', timeout: 15_000 }).toBe(EDIT);

      // "New draft from it" opens the new-draft flow on this master.
      await page.getByTestId('master-new-draft').click();
      await expect(page.getByTestId(`new-draft-master-${m.id}`)).toBeChecked();
      await api.dispose();
    });
});
