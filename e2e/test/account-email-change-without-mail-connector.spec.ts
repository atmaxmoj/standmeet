// account-email-change-without-mail-connector.spec.ts —— 没有 SMTP 时，改邮箱靠什么兜底。
//
// 确认信这条路（见 account-email-change-needs-confirmation.spec.ts）有前提：得有一个
// 已验证的 mail connector。没有的时候不能就把闸门拿掉 —— 那是「闸门粒度会挡掉好功能」的
// 反面：为了保住能用，把保护整个丢了。没有 SMTP 时退化成两件事：
//
//   1. 新邮箱输两遍。改密码已经要求输两遍（`account-password-confirm` 就在那儿），
//      同一个面板上同等危险的另一个动作却不要求 —— 这个不一致本身就是缺陷。
//   2. 把后果说全。现在的 blurb 只说 "Your login identity."，漏了后半句：恢复短语
//      寄到哪里也一起搬走。一句话说不全后果，跟没有这句话差不多。
//
// 判据：两遍不一致时**邮箱没变**（只断出现了错误提示不够 —— 「报了错但也改了」同样满足）；
// 一致时身份真的搬走，且**旧邮箱登不上**（只证明新的能登，证不出身份是搬走还是多了一个）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'nosmtp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'nosmtp',
  fullName: 'Nora NoSMTP',
};
const TYPO_EMAIL = 'nosmtp+mvoed@example.com';  // 手滑版
const GOOD_EMAIL = 'nosmtp+moved@example.com';

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
test.describe('account · no mail connector → double entry, and the consequence is stated', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    // 刻意**不**配 mail connector —— 这条 spec 测的就是没有 SMTP 的那一半。
    await request.dispose();
  });

  test('the email block says the recovery destination moves too',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      // owner 在按下按钮之前必须读到：这一步同时搬走了恢复渠道。
      await expect(page.getByTestId('account-email-block')).toContainText(/recovery/i);
    });

  test('mismatched confirmation is refused and the email does not move',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-email-current-password').fill(OWNER.password);
      await page.getByTestId('account-email-new').fill(GOOD_EMAIL);
      await page.getByTestId('account-email-confirm').fill(TYPO_EMAIL);

      // 保存按钮必须挡住 —— 两遍不一致时它不该是可按的。
      await expect(page.getByTestId('account-email-save')).toBeDisabled();

      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      expect(await currentEmail(request, csrf)).toBe(OWNER.email);
      await request.dispose();
    });

  test('matching confirmation moves the identity: new email lives, old email dies',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-email-current-password').fill(OWNER.password);
      await page.getByTestId('account-email-new').fill(GOOD_EMAIL);
      await page.getByTestId('account-email-confirm').fill(GOOD_EMAIL);
      await page.getByTestId('account-email-save').click();
      // 等保存**真的完成**再断登录 —— 点击是异步的，不等就是在断一个还没发生的事实。
      // 而且这句提示必须说的是"改好了"，不是"寄了封信"：没有 SMTP 时走的是直换那条路。
      await expect(page.getByTestId('toast-success')).toContainText(/updated to/i);

      const request = await playwright.request.newContext();
      expect(await loginStatus(request, GOOD_EMAIL, OWNER.password)).toBe(200);
      // 身份是**搬走**，不是多了一个。
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(401);
      await request.dispose();
    });
});
