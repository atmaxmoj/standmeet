// resume-master-default.spec.ts —— at most one master is the default, and the new-draft modal
// pre-selects it. Set B as default from its card → B wears the default badge, A no longer does, and
// "new draft" opens with B checked. docs/design/resume-masters.md, test 5.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { contentWith, listMasters, masterCard, openDrafts, seedMaster } from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-default@example.com', password: 'correct-horse-battery-staple',
  handle: 'masterdefault', fullName: 'Master Default Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · one default, pre-selected for a new draft', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('set B as default → only B is default; the new-draft modal pre-selects B',
    async ({ adminPage: page, playwright }) => {
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const a = await seedMaster(api, csrf, { name: 'General', resume_content: contentWith('A'), is_default: true });
      const b = await seedMaster(api, csrf, { name: 'Java backend', resume_content: contentWith('B') });

      await openDrafts(page);
      await expect(masterCard(page, 'General').getByTestId('master-default-badge')).toBeVisible();
      // The modal pre-selects the current default (A) before the change.
      await page.getByTestId('drafts-new').click();
      await expect(page.getByTestId(`new-draft-master-${a.id}`)).toBeChecked();
      await page.getByTestId('new-draft-cancel').click();

      await masterCard(page, 'Java backend').getByTestId('master-set-default').click();
      await expect(masterCard(page, 'Java backend').getByTestId('master-default-badge')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('master-default-badge'), 'only one default').toHaveCount(1);

      await page.getByTestId('drafts-new').click();
      await expect(page.getByTestId(`new-draft-master-${b.id}`)).toBeChecked();
      await expect(page.getByTestId(`new-draft-master-${a.id}`)).not.toBeChecked();

      const all = (await listMasters(api)).items;
      expect(all.filter((m) => m.is_default).map((m) => m.name), 'the server agrees').toEqual(['Java backend']);
      await api.dispose();
    });
});
