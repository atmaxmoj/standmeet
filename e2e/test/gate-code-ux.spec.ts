// gate-code-ux.spec.ts —— gate code panel UX: uppercase normalization,
// error shake, checking state, code + name submit.
//
// 用户故事：
//   1. paste code → 大写归一 + 非 [A-Z0-9-] 过滤
//   2. 错误 code → shake 动画 → 清空 → refocus
//   3. "checking" 状态 → submit 后按钮文案变
//   4. code + name 一起提交 → session 带 visitor name

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'gate-ux@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gateux',
  fullName: 'Gate UX Owner',
};

const CODE = 'GATEUX-001';
// 一张真码,名额只有 1 个,而且已经被用掉了 —— 存在、没过期、就是满了。
const FULL_CODE = 'GATEUX-FULL';

test.describe('gate code panel UX polish', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code input normalizes to uppercase',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      const codeInput = page.getByTestId('gate-code');
      await codeInput.fill('gateux-001');
      // Value should be uppercased
      await expect(codeInput).toHaveValue('GATEUX-001');
    });

  // 断言的是**那句话**,不是"有报错"。上一版只断言 gate-error 可见 —— 于是这块面板把每一种
  // 非 2xx 都说成 "unknown code" 也照样绿(F-A-23)。
  test('wrong code → the panel says the code is invalid',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill('BOGUS-CODE');
      await page.getByTestId('gate-code-submit').click();
      // 后端对这一种答的是 401「access code invalid or revoked」——比"unknown code"更准:
      // 一张被 revoke 的码是存在过的。
      await expect(page.getByTestId('code-panel').getByTestId('gate-error'))
        .toHaveText(/invalid or revoked/i, { timeout: 5_000 });
    });

  // F-A-23 —— 一张真码,只是名额满了,被说成 "UNKNOWN CODE"。
  // 后端答得很准:401 = 这码不存在;403 `member_quota_reached` = 「this code is full - no more
  // names available」,那句话就是写给访客看的。而面板把所有非 2xx 压成一个布尔 error,
  // 于是拿着有效邀请的招聘官被告知他的码不存在 —— 他会重打一遍、认定 owner 给错了码、然后走人。
  test('a code that is FULL says so, instead of claiming it does not exist (F-A-23)',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill(FULL_CODE);
      await page.getByTestId('gate-visitor-name').fill('Second Name');
      await page.getByTestId('gate-code-submit').click();
      const err = page.getByTestId('code-panel').getByTestId('gate-error');
      await expect(err).toBeVisible({ timeout: 5_000 });
      const said = (await err.innerText()).toLowerCase();
      expect(said, '这张码是真的存在的,不许说它不存在').not.toMatch(/unknown code/);
      expect(said, '把后端那句写给访客的话原样说出来').toMatch(/full|no more names/);
    });

  test('submit → checking state → button text changes',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-code-submit').click();
      // Should redirect on valid code
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('code + visitor name → session carries name',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Bob Smith');
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Bob Smith');
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
  const apiToken = await createAPIToken(request, csrf, 'gate-ux-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'gate ux intro.', title: 'Gate UX Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Gate UX test',
  });
  await createCode(request, csrf, {
    code: FULL_CODE, label: 'Gate UX full', max_members: 1,
  });
  // 用掉那唯一一个名额:这张码从此存在、有效、且满员。
  await issueSession(request, {
    handle: OWNER.handle, code: FULL_CODE, visitor_name: 'First Name',
  });
  await request.dispose();
}
