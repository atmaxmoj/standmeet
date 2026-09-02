// role-waypoints-admin.spec.ts -- F-A-7, the admin UI for the owner to **author
// ghost-steering waypoints** on /admin/roles. The whole waypoint mechanism has long been
// complete on the backend, and the admin API round-trips fine too -- there's simply nowhere
// in the GUI to write one. So on real instances every role has waypoints:[], and the ghost
// has nowhere to steer toward. This test guards:
//  1. a waypoint can be added on the card (id + description + weight + terminal + evidence)
//     -> save -> reload -> persists;
//  2. **the zeroing guard**: after adding a waypoint, saving the sibling dock must not zero
//     it out (roleUpdatePayload must carry waypoints -- this is the recurrence-prevention
//     line for the F-A-10 class of zeroing bug, on waypoints specifically).

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { expectSuccessToast } from '@/fixtures/toast';

const OWNER = {
  email: 'waypoints-admin@example.com', password: 'correct-horse-battery-staple',
  handle: 'wpadmin', fullName: 'Waypoints Admin Owner',
};
const WP_ID = 'book-a-call';
const WP_DESC = 'book a 30-min intro call';
const WP_EVIDENCE = 'wiki://cybernetics';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-A-7 · owner authors ghost waypoints from /admin/roles', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('role card starts with no waypoints, exposes an add affordance',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      await expect(row.getByTestId('role-wp-help')).toBeVisible();
      await expect(row.getByTestId('role-wp-add')).toBeVisible();
      await expect(row.getByTestId('role-wp-row-0')).toHaveCount(0);
    });

  // A geometric criterion, not a textual one ([[text-assertion-cannot-see-layout]]).
  //
  // Both input boxes on this row carry `.sm-field-input`, and that atom's `width:100%`
  // **isn't inside Tailwind's layer** -- so it overrides `w-[38%]`. Combined with its
  // sibling's `flex-1` (= `flex-basis: 0`), the description box's basis size is 0, and
  // shrinking is distributed by basis, so it ends up **permanently 0-width**: present in the
  // DOM, invisible on screen, and the owner can't click into it. Assertions like
  // `toBeVisible` can't see this — it just fails red as "element is not visible".
  test('两个输入框都真的占着地方（0 宽 = owner 打不进字）',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      await row.getByTestId('role-wp-add').click();
      const idBox = await row.getByTestId('role-wp-id-0').boundingBox();
      const descBox = await row.getByTestId('role-wp-desc-0').boundingBox();
      expect(idBox?.width ?? 0, 'id 框有宽度').toBeGreaterThan(80);
      expect(descBox?.width ?? 0, '描述框有宽度（红：0 —— 被 flex 挤没了）')
        .toBeGreaterThan(80);
    });

  test('author a waypoint → save → reload → persists',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      await row.getByTestId('role-wp-add').click();
      await row.getByTestId('role-wp-id-0').fill(WP_ID);
      await row.getByTestId('role-wp-desc-0').fill(WP_DESC);
      await row.getByTestId('role-wp-evidence-0').fill(WP_EVIDENCE);
      await row.getByTestId('role-wp-weight-0').fill('5');
      await row.getByTestId('role-wp-terminal-0').check();
      await row.getByTestId('role-wp-save').click();
      await expectSuccessToast(adminPage, /waypoint/i);
      await adminPage.reload();
      await openRoles(adminPage);
      const back = adminPage.getByTestId('role-row-steerer');
      await expect(back.getByTestId('role-wp-id-0')).toHaveValue(WP_ID);
      await expect(back.getByTestId('role-wp-desc-0')).toHaveValue(WP_DESC);
      await expect(back.getByTestId('role-wp-evidence-0')).toHaveValue(WP_EVIDENCE);
      await expect(back.getByTestId('role-wp-weight-0')).toHaveValue('5');
      await expect(back.getByTestId('role-wp-terminal-0')).toBeChecked();
    });

  test('sibling dock save does NOT zero the waypoint (zeroing regression guard)',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      await expect(row.getByTestId('role-wp-id-0')).toHaveValue(WP_ID);
      await row.getByTestId('role-dock-save').click();
      await expectSuccessToast(adminPage, /dock/i);
      await adminPage.reload();
      await openRoles(adminPage);
      // After the dock saves, the waypoint must still be there (roleUpdatePayload not carrying waypoints -> RED here).
      await expect(
        adminPage.getByTestId('role-row-steerer').getByTestId('role-wp-id-0'),
      ).toHaveValue(WP_ID);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createRole(request, csrf, {
    name: 'steerer', description: 's', corpus_uris: ['wiki://**'],
  });
  await request.dispose();
}

async function openRoles(page: Page): Promise<void> {
  await gotoAdminSection(page, 'roles');
  await page.waitForURL('**/admin/roles', { timeout: 5_000 });
  await expect(page.getByTestId('role-row-steerer')).toBeVisible({ timeout: 5_000 });
}
