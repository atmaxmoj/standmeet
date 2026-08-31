// account-email-pending-lifecycle.spec.ts —— 待确认的改邮箱，从生到死的每一格。
//
// `account-email-change-needs-confirmation.spec.ts` 只走了那条最顺的路：请求 → 收信 → 点开 → 换掉。
// 但一个待确认状态**能停在那里很久**，而停着的时候一切照常运转 —— 恢复短语要寄给谁？
// 又请求了一次怎么办？owner 在面板上看得见它吗？想反悔呢？这些格子里任何一格空着，
// 那个"不会把自己锁死"的保证就是漏的。
//
// 判据总纲：**pending 期间，身份和救命通道都必须还在旧地址上。** 新地址还没被证明，
// 提前把任何一样交给它，只是把洞挪了个位置。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, PlaywrightWorkerArgs } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance } from '@/fixtures/instance';
import {
  clearMailpit, configureMailConnector, confirmLinkIn, followMailedLink,
  mailpitHasNothingTo, waitForMailTo,
} from '@/fixtures/mail';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

// PW —— worker fixture 里那个 `playwright`。用例正文抽成模块级函数（max-lines-per-function），
// 于是得把它的类型写出来。
type PW = PlaywrightWorkerArgs['playwright'];

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pending@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pending',
  fullName: 'Pat Pending',
};
const FIRST = 'pending+first@example.com';
const SECOND = 'pending+second@example.com';

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, { data: { email, password } });
  return res.status();
}

async function requestChange(
  request: APIRequestContext, csrf: string, newEmail: string,
): Promise<number> {
  const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: OWNER.password, new_email: newEmail },
  });
  return res.status();
}

function pendingColumn(): string {
  return querySQL(`SELECT coalesce(pending_email, '') FROM owners WHERE handle = '${OWNER.handle}'`);
}

async function openAccount(page: Page): Promise<void> {
  await gotoAdminSection(page, 'account');
  await page.waitForURL('**/admin/account', { timeout: 5_000 });
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('account · the pending email change, every state it can sit in', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await clearMailpit(request);
    await request.dispose();
    execSQL(
      `UPDATE owners SET pending_email = NULL, pending_email_token_hash = '', ` +
      `pending_email_expires_at = NULL WHERE handle = '${OWNER.handle}'`,
    );
  });

  test('while a change is pending, the recovery phrase still goes to the OLD address',
    ({ playwright }) => recoveryStaysOnTheOldAddress(playwright));

  test('the panel shows the pending address, and the owner can cancel it',
    ({ adminPage }) => panelShowsAndCancels(adminPage));

  test('a second request replaces the first, and the first link is dead',
    ({ adminPage, playwright }) => secondRequestKillsTheFirst(adminPage, playwright));

  test('an expired link is refused, and the page says it expired',
    ({ adminPage, playwright }) => expiredLinkIsRefused(adminPage, playwright));

  test('a garbage or missing token gets a readable page, not a crash',
    ({ adminPage }) => garbageTokenIsReadable(adminPage));

  test('changing the password does not disturb a pending email change',
    ({ playwright }) => passwordChangeLeavesPendingAlone(playwright));
});

// ── 正文 ────────────────────────────────────────────────────────────

// 停在 pending 的时候，救命通道必须还在旧地址。
async function recoveryStaysOnTheOldAddress(playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  expect(await requestChange(request, csrf, FIRST)).toBe(200);
  await clearMailpit(request);

  const res = await request.post(`${BACKEND}/api/admin/account/recovery`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  expect(res.status()).toBe(200);

  // 寄到了旧地址。
  expect((await waitForMailTo(request, OWNER.email)).length).toBeGreaterThan(0);
  // 而且**没有**同时寄给那个还没被证明的新地址。
  expect(await mailpitHasNothingTo(request, FIRST),
    '恢复短语寄给了还没被证明的新地址 —— 洞只是换了个位置').toBe(true);
  await request.dispose();
}

// owner 看得见它，也退得出来。看不见的待确认状态 = 不知道自己按的那一下有没有生效。
async function panelShowsAndCancels(page: Page): Promise<void> {
  await openAccount(page);
  await page.getByTestId('account-email-current-password').fill(OWNER.password);
  await page.getByTestId('account-email-new').fill(FIRST);
  await page.getByTestId('account-email-confirm').fill(FIRST);
  await page.getByTestId('account-email-save').click();

  await expect(page.getByTestId('account-email-pending')).toContainText(FIRST);
  await page.getByTestId('account-email-pending-cancel').click();
  await expect(page.getByTestId('account-email-pending')).toBeHidden();
  expect(pendingColumn(), '取消只把它从屏幕上藏起来，库里还留着').toBe('');
}

// 两封信的链接都能用的话，owner 以为改成了 SECOND，而某个旧标签页一点就送去了 FIRST。
async function secondRequestKillsTheFirst(
  page: Page, playwright: PW,
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);

  expect(await requestChange(request, csrf, FIRST)).toBe(200);
  const firstLink = confirmLinkIn(await waitForMailTo(request, FIRST), 'confirm-email');

  await clearMailpit(request);
  expect(await requestChange(request, csrf, SECOND)).toBe(200);
  await waitForMailTo(request, SECOND);

  await followMailedLink(page, firstLink);
  await expect(page.getByTestId('email-confirmed')).toBeHidden();
  expect(await loginStatus(request, FIRST, OWNER.password)).toBe(401);
  expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
  await request.dispose();
}

// 说清楚是**过期**，不是"链接无效" —— owner 下一步该做什么，取决于这两个词的区别。
async function expiredLinkIsRefused(
  page: Page, playwright: PW,
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  expect(await requestChange(request, csrf, FIRST)).toBe(200);
  const link = confirmLinkIn(await waitForMailTo(request, FIRST), 'confirm-email');

  // 没有 API 造得出"已过期"这个状态，也不该有。
  execSQL(
    `UPDATE owners SET pending_email_expires_at = now() - interval '1 hour' ` +
    `WHERE handle = '${OWNER.handle}'`,
  );

  await followMailedLink(page, link);
  await expect(page.getByTestId('email-confirm-expired')).toBeVisible({ timeout: 10_000 });
  expect(await loginStatus(request, FIRST, OWNER.password)).toBe(401);
  expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
  await request.dispose();
}

async function garbageTokenIsReadable(page: Page): Promise<void> {
  // 走 goto fixture，不自己拼 host —— 上一版写死了 :3000（容器内的端口），
  // 而 app 对外是 :38127，于是失败原因是连接被拒，跟"页面说没说人话"毫无关系。
  await goto(page, '/confirm-email?token=nope');
  await expect(page.getByTestId('email-confirm-invalid')).toBeVisible({ timeout: 10_000 });
  // 界面上不许出现原始报错 —— CLAUDE.md 那条"错误必须是人话"。
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/panic|goroutine|sql:|pgx|500 Internal/i);
}

// 改密码和改邮箱是两件事，一件不该吃掉另一件。
async function passwordChangeLeavesPendingAlone(
  playwright: PW,
): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  expect(await requestChange(request, csrf, FIRST)).toBe(200);

  const newPassword = 'another-correct-horse-9876';
  const res = await request.patch(`${BACKEND}/api/admin/account/password`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: OWNER.password, new_password: newPassword },
  });
  // 改密码那条路由用的是 noContent —— 成功是 204，不是 200。
  expect(res.status()).toBe(204);

  expect(pendingColumn()).toBe(FIRST);
  expect(await loginStatus(request, OWNER.email, newPassword)).toBe(200);

  // 复位，别影响同文件后面的用例。
  const fresh = await login(request, OWNER.email, newPassword);
  await request.patch(`${BACKEND}/api/admin/account/password`, {
    headers: { 'X-Csrftoken': fresh.csrf },
    data: { current_password: newPassword, new_password: OWNER.password },
  });
  await request.dispose();
}
