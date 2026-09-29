// resume-master-overwrite.spec.ts —— a draft based on master A, edited, then "set as master ▾" →
// overwrite A (the default choice for a draft that came from a master) → A shows the edit, and the
// master editor opens with it. docs/design/resume-masters.md, test 4.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import {
  contentWith, editCoverLetter, getMaster, listMasters, masterCard, openComposerFor, saveAsMaster,
  seedDraft, seedMaster,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-overwrite@example.com', password: 'correct-horse-battery-staple',
  handle: 'masteroverwrite', fullName: 'Master Overwrite Owner',
};
const EDIT = 'OVERWRITTEN cover letter, sharpened in a draft';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · overwrite the master a draft came from', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('draft from A → edit → set as master → overwrite A → A carries the edit',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const a = await seedMaster(api, csrf, { name: 'General', resume_content: contentWith('ASUMMARY', 'OLD COVER') });
      const draft = await seedDraft(api, csrf, { company: 'TLDR', role: 'Applied AI', master_id: a.id });

      await openComposerFor(page, draft.id);
      await editCoverLetter(page, EDIT);
      await page.getByTestId('composer-save-as-master').click();
      // For a draft that came from A, overwriting A is the pre-selected choice and names A.
      const pop = page.getByTestId('save-as-master-popover');
      await expect(pop.getByTestId('save-master-overwrite')).toBeChecked();
      await expect(pop).toContainText('General');
      await pop.getByTestId('save-master-cancel').click();
      await saveAsMaster(page, { overwrite: true });

      await expect.poll(async () => (await getMaster(api, a.id)).resume_content.cover_letter,
        { message: 'A carries the edit', timeout: 15_000 }).toBe(EDIT);
      expect((await listMasters(api)).total, 'overwrite made no second master').toBe(1);

      // Visible outcome: A's editor shows the edited cover letter.
      await page.getByTestId('composer-back').click();
      await masterCard(page, 'General').getByTestId('master-edit').click();
      await expect(page.getByTestId('master-editor-banner')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel('Cover letter')).toHaveValue(EDIT, { timeout: 15_000 });
      await api.dispose();
    });
});
