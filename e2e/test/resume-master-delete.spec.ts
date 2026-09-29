// resume-master-delete.spec.ts —— deleting a master that a draft is based on leaves the draft alone:
// it still opens with its content, and its row no longer names a master (based_on_master_id is
// ON DELETE SET NULL). docs/design/resume-masters.md, test 7.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { contentWith, masterCard, openDrafts, seedDraft, seedMaster } from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-delete@example.com', password: 'correct-horse-battery-staple',
  handle: 'masterdelete', fullName: 'Master Delete Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · delete a master a draft is based on', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the master goes; the draft stays, opens, and stops naming it',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const m = await seedMaster(api, csrf, { name: 'Doomed master', resume_content: contentWith('DELSUMMARY kept by the draft') });
      const draft = await seedDraft(api, csrf, { company: 'Kraken', role: 'Engineer', master_id: m.id });
      await api.dispose();

      await openDrafts(page);
      const row = page.getByTestId('draft-card').filter({ hasText: 'Kraken' });
      await expect(row.getByTestId('draft-based-on')).toHaveText(/Doomed master/);

      await masterCard(page, 'Doomed master').getByTestId('master-delete').click();
      await page.getByTestId('master-delete-confirm').click();
      await expect(masterCard(page, 'Doomed master')).toHaveCount(0, { timeout: 10_000 });

      // The draft row is still there (its expiry chip renders) and names no master any more.
      await page.reload();
      await expect(row.getByTestId('draft-expiry')).toBeVisible({ timeout: 15_000 });
      await expect(row.getByTestId('draft-based-on')).toHaveCount(0);
      await expect(row).toContainText('DELSUMMARY');

      // It still opens with its content.
      await row.getByTestId(`draft-open-${draft.id}`).click();
      await expect(page.frameLocator('iframe').first().locator('[data-sec="summary"]'))
        .toContainText('DELSUMMARY', { timeout: 30_000 });
    });
});
