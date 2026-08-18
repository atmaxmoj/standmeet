// captcha-on-login-lift.spec.ts —— F-G-8：三扇门里，owner 自己那扇没有钥匙。
//
// gate 的两扇门（码 / 留言）被 per-IP 拦下之后，一次有效的人机校验就能过（F-G-3 / F-G-4）。
// **登录这扇门没有**：`serveLoginGuard` 先查限流再查校验，超限那条分支根本不看票，于是密码
// 完全正确、校验也解开了的 owner，照样被挡在自己的实例外面，直到窗口自己过去。
//
// 而 captcha 开着时那道校验**每一次登录都要过**——攻击者早就得为每次尝试付出代价了，
// 限流在这时挡不住他，只挡得住那个真正该进来的人。captcha 关着时不适用：那时没有校验可解，
// 硬锁是唯一的防线（`security-login-guard` 守的就是那一半）。
//
// 走 `make test-captcha`（Cloudflare 永远通过的测试密钥）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { skipUnlessCaptchaOn } from '@/fixtures/captcha';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'login-lift@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'loginlift',
  fullName: 'Login Lift Owner',
};

// ATTEMPTS —— 越过 `loginRateLimitMax`（30 / 5min）。
const ATTEMPTS = 34;

test.describe('login · a rate-limited owner can still clear the check and get in', () => {
  test.beforeAll(async ({ playwright }) => {
    // 这台没开 captcha 就整组跳过（而不是留一条恒定的红）—— 见 fixtures/captcha.ts。
    await skipUnlessCaptchaOn(await playwright.request.newContext());
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('past the attempt ceiling a solved check still lets the right password through',
    async ({ page }) => {
      await goto(page, '/login');
      // 先证这台实例真配了 captcha —— 否则「校验解开了还进不去」测的是一台压根没有校验的
      // 机器，红得不知所以然（[[red-in-the-wrong-place]]）。
      await expect(
        page.getByTestId('turnstile-host'),
        'captcha must be configured for this spec — run it via `make test-captcha`',
      ).toBeVisible({ timeout: 15_000 });

      // 从**浏览器自己**打过去，才算在同一个桶里：后端看到的来源就是这一页的来源。
      // 换个 APIRequestContext 去刷，刷的是另一个桶，闸门根本不会落在我面前这一页上。
      const seen = await hammer(page, ATTEMPTS);
      // 先确认真的敲够了次数：每一条都是一次**真回来的**响应，所以 34 条就是 34 次尝试，
      // 已经越过 30/5min 那条线。
      expect(
        seen.length, 'the attempt ceiling must actually be crossed',
      ).toBeGreaterThan(30);
      // 而这一路上不该出现 429：每一次提交都带着一张解开的票，闸就不该落在这个人头上。
      // 拿到的应当始终是「密码不对」——那是**真话**，也是他自己造成的。
      expect(
        seen, 'a person who clears the check on every try is not the one this ceiling is for',
      ).not.toContain(429);

      // 现在：正确的密码 + 那道自己出票的校验 → owner 必须进得去。
      await page.reload();
      await page.getByTestId('email').fill(OWNER.email);
      await page.getByTestId('password').fill(OWNER.password);
      await expect(
        page.getByTestId('submit'),
        'the form waits for the check to issue its token before it will submit',
      ).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('password').press('Enter');
      await expect(
        page,
        'a solved check is the way through this lock too — otherwise the owner is shut out of '
          + 'their own instance by a defence aimed at someone else',
      ).toHaveURL(/\/admin/, { timeout: 20_000 });
    });
});

// hammer —— 就在这张表单上连着敲错密码，返回每一次的状态码。
//
// 走表单而不是另起一个请求上下文：闸门按来源分桶，换个上下文刷的是**另一个桶**，落下来的
// 闸不在我面前这一页上。这也正是被防的那件事本来的样子 —— 有人对着登录框一遍遍试。
async function hammer(page: Page, times: number): Promise<number[]> {
  const seen: number[] = [];
  await page.getByTestId('email').fill(OWNER.email);
  // 等票到手再开始敲。widget 的宿主 div 一挂上就可见，但票要一两秒才出来，而在那之前提交键
  // 是禁用的 —— 回车按下去什么也不会发生，超时看起来像「产品不收登录」，其实是我抢在了前面。
  await page.getByTestId('password').fill('wrong-warmup');
  await expect(page.getByTestId('submit')).toBeEnabled({ timeout: 30_000 });
  for (let i = 0; i < times; i++) {
    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/admin/login'),
      { timeout: 20_000 },
    );
    await page.getByTestId('password').fill(`wrong-${i}`);
    await page.getByTestId('password').press('Enter');
    seen.push((await answered).status());
  }
  return seen;
}
