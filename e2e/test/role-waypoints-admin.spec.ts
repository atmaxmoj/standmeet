// role-waypoints-admin.spec.ts —— F-A-7 owner 在 /admin/roles 上**编写 ghost-steering waypoints**
// 的后台 UI。整套 waypoint 机制后端早就齐了、admin API 也 round-trip,唯独 GUI 上无处可写 —— 所以
// 真实例每个 role 都 waypoints:[],ghost 永远无处可去。这条守:
//  1. 卡上能加一条 waypoint(id + 描述 + 权重 + terminal + 证据)→ 存 → reload → 持久化;
//  2. **零化守卫**:加了 waypoint 之后再存 dock(兄弟保存),waypoint 不能被清零(roleUpdatePayload
//     必须带 waypoints —— 这是 F-A-10 零化 bug 类在 waypoints 上的复现防线)。

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

  // 几何判据，不是文本判据（[[text-assertion-cannot-see-layout]]）。
  //
  // 这一行的两个输入框都带 `.sm-field-input`，而那个原子里写着 `width:100%` 且**没进
  // Tailwind 的 layer** —— 它压过 `w-[38%]`。配上兄弟的 `flex-1`（= `flex-basis: 0`），
  // 描述框的基准尺寸是 0，收缩按基准分摊，于是它**恒定 0 宽**：DOM 里在、屏幕上没有、
  // owner 点不进去。`toBeVisible` 那一类断言看不见这件事，红出来只是 "element is not visible"。
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
      // dock 存完 waypoint 必须还在(roleUpdatePayload 不带 waypoints → 这里 RED)。
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
