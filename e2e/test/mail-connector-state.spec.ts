// mail-connector-state.spec.ts —— the mail panel's connected-state UI logic.
//
// 不是后端 OTP 那套(见 mail-otp.spec.ts),这里盯的是面板按状态切控件这条「挺
// 复杂的逻辑」:
//   1. 没填凭据   → 只有凭据表单,没有发码/验证控件、没有 ✓ verified。
//   2. 已 verified → 只剩 ✓ email verified + Disconnect;发码、输码、Verify 全收起
//                    (除非再 disconnect,不会再让你发码 —— 防误触重发)。
//   3. disconnect → 验证流程整套回来,✓ verified 消失。
// 真页面 + 真后端(Mailpit 捕 SMTP),adminPage 自动登录 owner。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { configureMailConnector } from '@/fixtures/mail';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'mailstate@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mailstate',
  fullName: 'Mail State Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('mail connector connected-state UI', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // Runs first — before any credentials exist: the verify flow must not show at all.
  test('no credentials → only the form, no verify controls, no verified line',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      await adminPage.waitForURL('**/admin/connectors', { timeout: 5_000 });
      const panel = adminPage.getByTestId('mail-connector-panel');
      await expect(panel.getByTestId('mail-host')).toBeVisible(); // creds form is there
      await expect(panel.getByTestId('mail-send-otp')).toHaveCount(0);
      await expect(panel.getByTestId('mail-verify-otp')).toHaveCount(0);
      await expect(panel.getByTestId('mail-verified')).toHaveCount(0);
    });

  test('verified → send/verify hidden, only Disconnect; disconnect brings them back',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password); // → connected
      await request.dispose();

      await gotoAdminSection(adminPage, 'connectors');
      await adminPage.waitForURL('**/admin/connectors', { timeout: 5_000 });
      const panel = adminPage.getByTestId('mail-connector-panel');

      // verified: the ✓ line + Disconnect, and nothing to (re)send or verify.
      await expect(panel.getByTestId('mail-verified')).toBeVisible();
      await expect(panel.getByTestId('mail-disconnect')).toBeVisible();
      await expect(panel.getByTestId('mail-send-otp')).toHaveCount(0);
      await expect(panel.getByTestId('mail-otp-code')).toHaveCount(0);
      await expect(panel.getByTestId('mail-verify-otp')).toHaveCount(0);

      // disconnect removes the connector → back to the bare form, no verify
      // controls and no ✓ line (you re-enter creds to verify again).
      await panel.getByTestId('mail-disconnect').click();
      await expect(panel.getByTestId('mail-verified')).toHaveCount(0);
      await expect(panel.getByTestId('mail-send-otp')).toHaveCount(0);
      await expect(panel.getByTestId('mail-host')).toBeVisible();

      // re-save credentials → the verify flow comes back (send-code returns).
      await panel.getByTestId('mail-host').fill('mailpit');
      await panel.getByTestId('mail-port').fill('1025');
      await panel.getByTestId('mail-from-address').fill('noreply@standmeet.test');
      await panel.getByTestId('mail-save-credentials').click();
      await expect(panel.getByTestId('mail-send-otp')).toBeVisible();
    });
});
