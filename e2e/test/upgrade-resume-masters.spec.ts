// upgrade-resume-masters.spec.ts —— an old volume + new code: the deploy carries the résumé-masters
// migration (`2026-09-29-resume-masters.sql`: the resume_masters table and
// resume_drafts.based_on_master_id).
//
// The full suite only exercises a fresh volume (schema.sql), which proves nothing about an upgrade.
// Method (mirrors upgrade-microsite-access): on a DB with an owner, a live draft and an application,
// roll back to the real pre-upgrade shape — drop the column and the table, delete this migration's
// ledger row — then do exactly one thing: restart the backend (= deploy). The migration must arrive
// through the real mechanism, never applied by the test.
//
// What the upgrade must keep: the existing draft still opens and commits; the existing application is
// still listed; the masters strip is empty and "+ new master" works.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { contentWith, openDrafts, seedDraft, seedDraftContent } from '@/fixtures/resume-masters';
import { commitDraftAPI } from '@/fixtures/admin-mutations';
import { createCode } from '@/fixtures/codes';

const MIGRATION = '2026-09-29-resume-masters.sql';
const LATER_MASTERS_MIGRATION = '2026-10-08-resume-master-trash.sql';

const OWNER = {
  email: 'masters-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'mastersupgrader', fullName: 'Masters Upgrader',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

function count(sql: string): number {
  return Number(querySQL(sql));
}

let liveDraft = '';

test.describe('upgrade · deploying the new version adds résumé masters to a live instance', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // One draft that gets committed now (an existing application) and one that stays live.
    const sent = await seedDraft(request, csrf, { company: 'Sent Co', role: 'Engineer' });
    await seedDraftContent(request, csrf, sent.id, contentWith('SENTSUMMARY'));
    await commitDraftAPI(request, csrf, sent.id);
    // A plain code, newer than the application's: the composer's QR picker defaults to the newest
    // active code, and a code already bound to an application cannot carry a second one.
    await createCode(request, csrf, { code: 'PUBLIC-UPG', label: 'public' });
    const live = await seedDraft(request, csrf, { company: 'Live Co', role: 'Engineer' });
    await seedDraftContent(request, csrf, live.id, contentWith('LIVESUMMARY'));
    liveDraft = live.id;
    await request.dispose();
  });

  // Safety net: if a test dies mid-run the DB is left in the old shape; one more restart fixes it.
  test.afterAll(() => { restartBackend(); });

  test('an old volume with a live draft and an application + a deploy → schema applied', () => {
    // Roll back to the pre-upgrade shape — it must actually take effect, or this is a fake,
    // permanently-green upgrade test.
    execSQL('ALTER TABLE resume_drafts DROP COLUMN IF EXISTS based_on_master_id');
    execSQL('DROP TABLE IF EXISTS resume_masters');
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    // A volume from before masters is also from before every later change to that table: forget
    // those migrations too, or the deploy rebuilds resume_masters without their columns
    // (2026-10-08-resume-master-trash.sql's deleted_at) and every masters read fails.
    execSQL(`DELETE FROM schema_migrations WHERE name = '${LATER_MASTERS_MIGRATION}'`);
    expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='resume_masters'`),
      'pre-state not built: the table is still there').toBe(0);
    expect(count(`SELECT count(*) FROM information_schema.columns
                  WHERE table_name='resume_drafts' AND column_name='based_on_master_id'`),
      'pre-state not built: the column is still there').toBe(0);

    // Upgrade = deploy. No other action.
    restartBackend();

    expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='resume_masters'`)).toBe(1);
    expect(count(`SELECT count(*) FROM information_schema.columns
                  WHERE table_name='resume_drafts' AND column_name='based_on_master_id'`)).toBe(1);
    expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
    expect(count('SELECT count(*) FROM resume_drafts'), 'the live draft survives the upgrade').toBe(1);
    expect(count('SELECT count(*) FROM applications'), 'the application survives the upgrade').toBe(1);
  });

  test('…the old draft still opens and commits; the strip is empty and "+ new master" works',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await openDrafts(page);
      await expect(page.getByTestId('masters-empty'), 'no masters yet').toBeVisible();
      await expect(page.getByTestId('master-card')).toHaveCount(0);

      // "+ new master" → a named blank master → its editor opens; back on the page the strip lists it.
      await page.getByTestId('master-new').click();
      await page.getByTestId('new-master-name').fill('First master');
      await page.getByTestId('new-master-create').click();
      await expect(page.getByTestId('master-editor-banner')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('composer-back').click();
      await expect(page.getByTestId('master-card')).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByTestId('master-card')).toContainText('First master');

      // The pre-upgrade draft opens with its content and commits.
      await page.getByTestId(`draft-open-${liveDraft}`).click();
      await expect(page.frameLocator('iframe').first().locator('[data-sec="summary"]'))
        .toContainText('LIVESUMMARY', { timeout: 30_000 });
      await page.getByTestId('composer-send').click();
      await page.getByTestId('composer-confirm-send').click();
      await expect(page.getByTestId('masters-strip')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => count('SELECT count(*) FROM applications'), { timeout: 30_000 }).toBe(2);

      await gotoAdminSection(page, 'applications');
      await expect(page.getByText('Live Co').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Sent Co').first()).toBeVisible();
    });
});
