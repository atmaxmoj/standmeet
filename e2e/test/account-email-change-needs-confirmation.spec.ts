// account-email-change-needs-confirmation.spec.ts —— owner 改邮箱不能把自己锁死。
//
// 缺陷（手工发现 2026-08-30）：`owners.email` 这一列同时是**登录身份**和**恢复渠道**
// （`usecase/recovery.go` 的 `To:` 直接读它）。改邮箱把两者原子地一起搬走，而搬走之前
// 没有任何一步证明新地址收得到信。所以一个拼写错误同时拿掉了钥匙和备用钥匙 —— 而且
// session 按 ownerID 发，当场毫无感觉，它在 session 过期那天才生效。
//
// 判据（断好结果，不断"没红字"）：配好 mail connector 之后，改邮箱**只产生一封确认信**，
// 身份**不动**；旧邮箱在确认之前必须还能登录 —— 这一条才是"没被锁死"的真正含义。
// 只断"出现了成功提示"不行：那是 non-unique signal，产品把身份换掉了也会显示成功。
//
// 收据在动作旁边验：确认信去 mailpit（外部收件箱）读，不看产品自己说"已发送"。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  clearMailpit, configureMailConnector, confirmLinkIn, followMailedLink, waitForMailTo,
} from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'confirmer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'confirmer',
  fullName: 'Connie Confirmer',
};
const NEW_EMAIL = 'confirmer+moved@example.com';

// loginStatus —— 只要状态码。login() 在失败时抛，这里要的正是"失败"这件事本身。
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
test.describe('account · a new email must prove it is reachable before it becomes the login', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await clearMailpit(request);
    await request.dispose();
  });

  test('with a verified mail connector: the change is pending until the new address confirms it',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      // 动手之前，这一块说的话必须跟它的行为一致。加待确认流程之前它写着
      // "Changing it moves both" —— 机制换了、说明书没换，于是它对 owner 撒谎，
      // 而这种谎言不会让任何测试变红（[[names-that-lie]]）。在真 prod 上眼验才看见。
      const blurb = await page.getByTestId('account-email-block').innerText();
      expect(blurb, '这块说明还在承诺"改了就生效"，而实际要等确认').toContain('confirm');
      expect(blurb).not.toContain('moves both');

      await page.getByTestId('account-email-current-password').fill(OWNER.password);
      await page.getByTestId('account-email-new').fill(NEW_EMAIL);
      await page.getByTestId('account-email-confirm').fill(NEW_EMAIL);
      await page.getByTestId('account-email-save').click();

      // 界面必须说清这是"寄了一封信"，不是"改好了" —— owner 读到的那句话决定他接下来做什么。
      await expect(page.getByTestId('account-email-pending')).toContainText(NEW_EMAIL);

      const request = await playwright.request.newContext();

      // ① 身份没动：旧邮箱**仍然**能登录。这条是"没被锁死"的实际含义。
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
      // ② 新邮箱在确认之前不是身份。
      expect(await loginStatus(request, NEW_EMAIL, OWNER.password)).toBe(401);
      // ③ /me 读到的还是旧的。
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      expect(await currentEmail(request, csrf)).toBe(OWNER.email);

      // ④ 收据去外部收件箱验：确认信寄到了**新**地址（不是旧的）。
      const body = await waitForMailTo(request, NEW_EMAIL);
      const link = confirmLinkIn(body, 'confirm-email');

      // ⑤ 走真实的那条路 —— 用浏览器点开信里的链接，而不是直接打 API。
      //    「test covers capability, not face」：只打 API 的话，链接页面根本不存在也能绿。
      await followMailedLink(page, link);
      await expect(page.getByTestId('email-confirmed')).toBeVisible({ timeout: 10_000 });

      // ⑥ 现在身份才搬走：新的能登，旧的死。
      expect(await loginStatus(request, NEW_EMAIL, OWNER.password)).toBe(200);
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(401);
      const after = await login(request, NEW_EMAIL, OWNER.password);
      expect(await currentEmail(request, after.csrf)).toBe(NEW_EMAIL);

      // ⑦ 确认链接是一次性的 —— 可重放的确认链接等于把身份挂在一封旧邮件上。
      await followMailedLink(page, link);
      await expect(page.getByTestId('email-confirmed')).toBeHidden();

      await request.dispose();
    });
});
