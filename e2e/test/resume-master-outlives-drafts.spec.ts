// resume-master-outlives-drafts.spec.ts —— a master does not expire with the drafts. Make a master
// from a draft, expire every draft (psql, like resume-draft-ttl: there is no "wind the clock"
// endpoint), run the sweep (it runs at backend boot — restartBackend is the deploy path) → the drafts
// are gone, the master is still listed and opens with its content. docs/design/resume-masters.md,
// test 2.
//
// Serial: restarts the backend.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { execSQL, restartBackend } from '@/fixtures/instance';
import {
  contentWith, masterCard, openDrafts, seedDraft, seedDraftContent, seedMaster,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-outlives@example.com', password: 'correct-horse-battery-staple',
  handle: 'masteroutlives', fullName: 'Master Outlives Owner',
};
const SUMMARY = 'Durable SUMMARYOUTLIVE résumé the owner keeps.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · a master outlives every draft', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });
  test.afterAll(() => { restartBackend(); });

  test('drafts expire and are swept; the master stays listed and opens with its content',
    async ({ adminPage: page, playwright }) => {
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const draft = await seedDraft(api, csrf, { company: 'Elastic', role: 'Java Developer', blank: true });
      await seedDraftContent(api, csrf, draft.id, contentWith(SUMMARY));
      await seedMaster(api, csrf, { name: 'Java backend', draft_id: draft.id });

      // Precondition: the draft is on the page, so its disappearance below is the sweep's doing.
      await openDrafts(page);
      await expect(page.getByTestId(`draft-open-${draft.id}`)).toBeVisible({ timeout: 15_000 });

      execSQL(`UPDATE resume_drafts SET expires_at = now() - interval '1 hour'`);
      restartBackend(); // the resume-draft sweep runs at boot
      await api.dispose();

      await page.reload();
      await expect(page.getByTestId('masters-strip')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('drafts-empty'), 'the drafts were swept').toBeVisible({ timeout: 15_000 });
      const card = masterCard(page, 'Java backend');
      await expect(card, 'the master is still listed').toHaveCount(1);
      await expect(card).toContainText('SUMMARYOUTLIVE');

      await card.getByTestId('master-edit').click();
      await expect(page.getByTestId('master-editor-banner')).toBeVisible({ timeout: 30_000 });
      await expect(page.frameLocator('iframe').first().locator('[data-sec="summary"]'))
        .toContainText('SUMMARYOUTLIVE', { timeout: 30_000 });
    });
});
