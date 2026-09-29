// resume-master-new-draft-from-master.spec.ts —— "new draft" asks where to start ("从哪份开始"): each
// master (the default pre-selected) or blank. Pick a NON-default master → the draft opens with that
// master's content and its row says "based on: <name>"; editing and saving the draft leaves the master
// unchanged (a draft is a copy). docs/design/resume-masters.md, test 3.
//
// This replaces the old "copy the newest draft" corner in CreateManualDraft: a draft now starts from
// the master the owner picks.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import {
  contentWith, editCoverLetter, getDraftContent, getMaster, masterCard, openDrafts, seedMaster,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-newdraft@example.com', password: 'correct-horse-battery-staple',
  handle: 'masternewdraft', fullName: 'Master New Draft Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · a new draft starts from the chosen master', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('pick a non-default master → the draft has its content and says so; the master stays unchanged',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      await seedMaster(api, csrf, {
        name: 'General', resume_content: contentWith('GENERALSUMMARY all-round'), is_default: true,
      });
      const java = await seedMaster(api, csrf, {
        name: 'Java backend', resume_content: contentWith('JAVASUMMARY Spring and Quarkus', 'JAVA COVER'),
      });

      await openDrafts(page);
      await expect(masterCard(page, 'Java backend')).toHaveCount(1);
      await page.getByTestId('drafts-new').click();
      const form = page.getByTestId('new-draft-form');
      await expect(form).toBeVisible();
      await form.getByTestId('new-draft-company').fill('Matcha');
      await form.getByTestId('new-draft-role').fill('Founding Engineer');
      // The picker lists both masters and blank; pick the non-default one.
      await expect(form.getByTestId('new-draft-master-blank')).toBeVisible();
      await form.getByTestId(`new-draft-master-${java.id}`).check();
      await form.getByTestId('new-draft-create').click();
      await expect(form).toBeHidden({ timeout: 10_000 });

      const row = page.getByTestId('draft-card').filter({ hasText: 'Matcha' });
      await expect(row).toHaveCount(1, { timeout: 10_000 });
      await expect(row.getByTestId('draft-based-on')).toHaveText(/based on: Java backend/i);
      await expect(row).toContainText('JAVASUMMARY');
      const draftID = await row.getAttribute('data-draft-id');
      expect(draftID, 'the draft card names its draft').toBeTruthy();

      // Open it: the composer shows the master's content.
      await row.getByTestId(`draft-open-${draftID}`).click();
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
      await expect(page.frameLocator('iframe').first().locator('[data-sec="summary"]'))
        .toContainText('JAVASUMMARY', { timeout: 30_000 });
      await expect(page.getByTestId('composer-based-on')).toContainText('Java backend');

      // Edit and save the draft: the draft changes, the master does not.
      await editCoverLetter(page, 'DRAFT-ONLY cover for Matcha');
      await page.getByTestId('puck-save').click();
      await expect.poll(async () => (await getDraftContent(api, draftID!)).cover_letter,
        { timeout: 15_000 }).toBe('DRAFT-ONLY cover for Matcha');
      expect((await getMaster(api, java.id)).resume_content.cover_letter,
        'the master is untouched by the draft edit').toBe('JAVA COVER');
      await api.dispose();
    });
});
