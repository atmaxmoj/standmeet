// resume-master-save-from-draft.spec.ts —— a draft the owner tailored can be kept: in the composer,
// "set as master ▾" → save as a new master with a name → the drafts page's masters strip shows it
// (with the draft's summary text on its thumbnail), and the master editor opens with the same
// content. docs/design/resume-masters.md, test 1.
//
// Why: a draft lives one day. Before masters, the only lasting copy of a résumé was an application
// row; the owner: "那个resume没有持久的我还是挺不爽的".
//
// Also the one zh assertion the design asks for (test 10): the strip's heading under /zh.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { openReader } from '@/fixtures/navigate';
import {
  contentWith, masterCard, openComposerFor, openDrafts, saveAsMaster, seedDraft, seedDraftContent,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-save@example.com', password: 'correct-horse-battery-staple',
  handle: 'mastersave', fullName: 'Master Save Owner',
};
const SUMMARY = 'Platform engineer SUMMARYMSAVE who ships retrieval systems.';
const NAME = 'AI platform';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · save a draft as a master', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('composer → set as master → new name → the strip shows it; the master editor opens with the same content',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const draft = await seedDraft(api, csrf, { company: 'Kraken', role: 'Staff Engineer', blank: true });
      await seedDraftContent(api, csrf, draft.id, contentWith(SUMMARY));

      // Before: the strip is there and holds no master of that name.
      await openDrafts(page);
      await expect(page.getByTestId('masters-strip')).toContainText(/masters/i);
      await expect(masterCard(page, NAME)).toHaveCount(0);

      // In the composer: set as master → a new master named NAME.
      await openComposerFor(page, draft.id);
      await saveAsMaster(page, { name: NAME });

      // Back on the drafts page: the card shows the name, the draft's summary on its thumbnail, and
      // which draft it came from.
      await page.getByTestId('composer-back').click();
      await expect(page.getByTestId('masters-strip')).toBeVisible({ timeout: 15_000 });
      const card = masterCard(page, NAME);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('SUMMARYMSAVE');
      await expect(card.getByTestId('master-meta')).toContainText('Kraken');

      // The master editor opens with the same content (the summary on its canvas).
      await card.getByTestId('master-edit').click();
      await expect(page.getByTestId('master-editor-banner')).toBeVisible({ timeout: 30_000 });
      await expect(page.frameLocator('iframe').first().locator('[data-sec="summary"]'))
        .toContainText('SUMMARYMSAVE', { timeout: 30_000 });

      // zh: the strip's heading is translated.
      await openReader(page, '/zh/admin/drafts');
      await expect(page.getByTestId('masters-strip')).toContainText('母版', { timeout: 15_000 });
      await api.dispose();
    });
});
