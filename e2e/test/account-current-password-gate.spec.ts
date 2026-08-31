// account-current-password-gate.spec.ts —— 改邮箱/改密码那道"先验当前密码"的闸门。
//
// 缺陷（审计 2026-08-30）：`verifyCurrentPassword` 是 change_email / change_password
// **存在的全部理由**，而在这条 spec 之前，没有任何一条用例走过"密码填错"这条路。
// 把它整个改成 `return nil`，整套测试照样绿 —— 一道从来没被红过的闸门不是闸门。
//
// 这也是「覆盖全是失败路径」的镜像版本：那条讲的是只测了错误路径没测成功路径；
// 这里反过来 —— 只测了成功路径，那道专门用来拒绝的装置一次都没被要求拒绝过。
//
// 判据（断好结果）：拒绝之后**东西没变**。只断"出现了错误提示"不够 ——
// 「报了错但也改了」同样会出现错误提示，而那正是最坏的那种失败。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { expectErrorToast } from '@/fixtures/toast';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const WRONG = 'this-is-not-the-password';

const OWNER = {
  email: 'gated@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gated',
  fullName: 'Gary Gated',
};
const TARGET_EMAIL = 'gated+moved@example.com';
const TARGET_PASSWORD = 'attacker-chosen-98765';

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, {
    data: { email, password },
  });
  return res.status();
}

async function currentEmail(request: APIRequestContext, csrf: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/admin/me`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`me: ${res.status()}`);
  return (await res.json() as { owner: { email: string } }).owner.email;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('account · the current-password gate refuses, and nothing moves', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('wrong current password → email refused, and the email does not move',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-email-current-password').fill(WRONG);
      await page.getByTestId('account-email-new').fill(TARGET_EMAIL);
      await page.getByTestId('account-email-confirm').fill(TARGET_EMAIL);
      await page.getByTestId('account-email-save').click();

      await expectErrorToast(page, /password/i);

      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      expect(await currentEmail(request, csrf)).toBe(OWNER.email);
      // 那个地址不能成为身份 —— 连"待确认"都不该有。
      expect(await loginStatus(request, TARGET_EMAIL, OWNER.password)).toBe(401);
      await request.dispose();
    });

  test('wrong current password → password refused, and the old password still works',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-password-current').fill(WRONG);
      await page.getByTestId('account-password-new').fill(TARGET_PASSWORD);
      await page.getByTestId('account-password-confirm').fill(TARGET_PASSWORD);
      await page.getByTestId('account-password-save').click();

      await expectErrorToast(page, /password/i);

      const request = await playwright.request.newContext();
      // 旧密码还能登 = 密码确实没被换掉。
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
      // 想换成的那个不能登。
      expect(await loginStatus(request, OWNER.email, TARGET_PASSWORD)).toBe(401);
      await request.dispose();
    });
});
