// resume-master-paging.spec.ts —— the masters strip and the drafts list both page through the one
// paging util (docs/design/paging.md): more rows than one page (50) → the header counts come from the
// server's total, the first page shows 50, and LoadMore reaches the last (oldest) row.
// docs/design/resume-masters.md, test 9 (owner 2026-09-29: "分页也要做好了，别忘了").

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { contentWith, masterCard, openDrafts, seedDraft, seedMaster } from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-paging@example.com', password: 'correct-horse-battery-staple',
  handle: 'masterpaging', fullName: 'Master Paging Owner',
};
const N = 51; // one more than the default page size
const pad = (i: number) => String(i).padStart(2, '0');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé masters · paging', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('51 masters and 51 drafts: counts are right, the pager reaches the oldest of each',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(180_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      for (let i = 0; i < N; i++) await seedMaster(api, csrf, { name: `Master ${pad(i)}`, resume_content: contentWith(`M${pad(i)}`) });
      for (let i = 0; i < N; i++) await seedDraft(api, csrf, { company: `Company ${pad(i)}`, role: 'Engineer', blank: true });
      await api.dispose();

      await openDrafts(page);
      // Counts come from the server's total, not the loaded page.
      await expect(page.getByTestId('masters-total')).toHaveText(String(N), { timeout: 15_000 });
      await expect(page.getByTestId('section-header')).toContainText(`${N} pending`);

      // Masters: first page is 50, newest first; LoadMore brings the oldest.
      await expect(page.getByTestId('master-card')).toHaveCount(50, { timeout: 15_000 });
      await expect(masterCard(page, 'Master 50')).toHaveCount(1);
      await page.getByTestId('masters-load-more').click();
      await expect(page.getByTestId('master-card')).toHaveCount(N, { timeout: 15_000 });
      await expect(masterCard(page, 'Master 00')).toHaveCount(1);
      await expect(page.getByTestId('masters-load-more'), 'the last page is in').toHaveCount(0);

      // Drafts: same util.
      await expect(page.getByTestId('draft-card')).toHaveCount(50, { timeout: 15_000 });
      await page.getByTestId('drafts-load-more').click();
      await expect(page.getByTestId('draft-card')).toHaveCount(N, { timeout: 15_000 });
      await expect(page.getByTestId('draft-card').filter({ hasText: 'Company 00' })).toHaveCount(1);
      await expect(page.getByTestId('drafts-load-more'), 'the last page is in').toHaveCount(0);
    });
});
