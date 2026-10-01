// resume-master-default-past-first-page.spec.ts —— the default master starts a new draft even when
// it is not on the first loaded page of masters.
//
// The new-draft picker pre-selected the default master only when it was among the loaded rows. With
// more masters than one page (50), an old default sat on page two: the picker checked "blank", and a
// draft the owner meant to start from their default started empty (ledger 2026-09-29, a ponytail
// left in startChoice). docs/design/resume-masters.md.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { contentWith, getDraftContent, openDrafts, seedMaster } from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-default-p2@example.com', password: 'correct-horse-battery-staple',
  handle: 'masterdefaultp2', fullName: 'Master Default Owner',
};
const DEFAULT_MARK = 'DEFAULT-MASTER-SUMMARY-7Q';
const pad = (i: number) => String(i).padStart(2, '0');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// Claimed before the test: adminPage signs in during fixture setup, before the test body runs.
test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

test('a default master on page two still starts the new draft', async ({ adminPage: page, playwright }) => {
  test.setTimeout(180_000);
  const api = await playwright.request.newContext();
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
  // Oldest first: the default is the oldest, so newest-first paging puts it past the first 50.
  await seedMaster(api, csrf, { name: 'The default', resume_content: contentWith(DEFAULT_MARK), is_default: true });
  for (let i = 0; i < 50; i++) await seedMaster(api, csrf, { name: `Other ${pad(i)}`, resume_content: contentWith(`O${pad(i)}`) });

  await openDrafts(page);
  await page.getByTestId('drafts-new').click();
  const form = page.getByTestId('new-draft-form');
  await form.getByTestId('new-draft-company').fill('Pagecorp');
  await expect(form.getByTestId('new-draft-master-default'), 'the default is offered and chosen')
    .toBeChecked({ timeout: 15_000 });
  await form.getByTestId('new-draft-create').click();

  const row = page.getByTestId('draft-card').filter({ hasText: 'Pagecorp' });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row.getByTestId('draft-based-on'), 'the draft names its master').toHaveText(/based on: The default/i);
  const draftID = (await row.getAttribute('data-draft-id')) ?? '';
  expect(draftID, 'the draft card carries its id').not.toBe('');
  expect((await getDraftContent(api, draftID)).summary, 'the draft copied the default master')
    .toBe(DEFAULT_MARK);
  await api.dispose();
});
