// gate-lock-offers-only-what-exists.spec.ts —— F-G-7：被闸门拦下时那句话，只许承诺**这台
// 实例此刻真给得出**的下一步。
//
// gate 上两扇门各有一道 per-IP 闸（无效码 / 留言），两道闸都能被一次人机校验解开 —— **但只有
// 配了 captcha 的实例才有那道校验**，而默认部署没有（`TURNSTILE_*` 不设 → `CaptchaEnabled=false`）。
// 上一版两句拒绝都写死成「过一次人机校验就放你过去」，于是在**绝大多数**部署上，被拦下的访客
// 读到的是一个页面上根本不存在的控件；他会去找、找不到，然后以为自己被永久挡住了。
//
// 这条 spec 跑在**默认栈**（captcha 关着）——也就是那句话最容易骗人的那种部署。反向那一半
// （captcha 开着时必须**指出**那条出路，而不是说「稍后再试」）由 `captcha-on-gate-unlock`
// 守着；两边合起来才钉得住「说的和有的是同一件事」。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'lock-copy@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'lockcopy',
  fullName: 'Lock Copy Owner',
};

// NOTE_FLOOD / CODE_FLOOD —— 分别越过两道闸的阈值（留言 5 / 无效码 10）。
const NOTE_FLOOD = 7;
const CODE_FLOOD = 12;

test.describe('gate · a refusal names a way out only when there is one', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  // 前提先验，别默认。这条 spec 说的是「**没配 captcha** 的实例」，而 captcha 是不是开着
  // 由环境决定 —— `docker compose` 会自动读仓库根的 `.env`，我给 prod 填的那对测试密钥
  // 顺带把 dev 栈也点着了，于是这两条用例第一次跑出来的红**红错了地方**：产品说「过一次
  // 人机校验」在那个栈上是对的。前提没被断言时，一次红看起来跟真缺陷一模一样。
  test.beforeEach(async ({ page }) => {
    const res = await page.request.get('/api/v1/instance');
    const body: unknown = await res.json();
    const siteKey = typeof body === 'object' && body !== null && 'captcha_site_key' in body
      ? body.captcha_site_key : '';
    expect(
      siteKey ?? '',
      'this spec is about an instance with NO captcha — run it on the default stack '
        + '(no TURNSTILE_* in the shell and none in .env), not through make test-captcha',
    ).toBe('');
  });

  test('the note door, with no captcha configured, does not send the visitor looking for one',
    async ({ page }) => {
      for (let i = 0; i < NOTE_FLOOD; i++) {
        await goto(page, '/gate');
        await sendNote(page, i);
      }

      // 正对照：确实被拦下了，而且这句话真的印在留言口上。没有它，下面两条在页面空白时也过。
      const err = page.getByTestId('request-error');
      await expect(
        err, 'past the threshold the note door refuses, and says so on the form',
      ).toBeVisible({ timeout: 15_000 });

      // 判据是**那句话的内容**：这台实例没有配 captcha，屏幕上不会出现任何校验，
      // 所以那句话不许说「过一次人机校验」。
      await expect(
        err,
        'with no captcha configured there is no check to clear — the refusal must not name one',
      ).not.toContainText('human check');
      await expect(
        page.getByTestId('request-captcha'),
        'and there is indeed no check on screen — which is why naming one would be a lie',
      ).toHaveCount(0);
    });

  test('the code door, with no captcha configured, does not send the visitor looking for one',
    async ({ page }) => {
      await goto(page, '/gate');
      for (let i = 0; i < CODE_FLOOD; i++) {
        await page.getByTestId('gate-code').fill(`NOPE-${String(i).padStart(3, '0')}`);
        // 闸门一落，提交键就被禁掉（captcha 关着时没有票可拿），再敲下去不会有任何请求 ——
        // 所以循环停在这里，而不是坐等一个永远不会来的响应。
        if (await page.getByTestId('gate-code-submit').isDisabled()) break;
        // 每一次都等那次兑换真的回来再敲下一个 —— 靠固定 sleep 的话，机器慢一点就少敲几次，
        // 闸门没落下，而失败长得像「产品没锁」。
        const answered = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/sessions'),
          { timeout: 15_000 },
        );
        await page.getByTestId('gate-code').press('Enter');
        await answered;
      }

      const err = page.getByTestId('code-panel').getByTestId('gate-error');
      await expect(
        err, 'past the threshold the code door refuses, and says so under the input',
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        err,
        'with no captcha configured the code door has no check either — do not promise one',
      ).not.toContainText('human check');
      await expect(
        page.getByTestId('gate-captcha'),
        'and there is indeed no check on screen',
      ).toHaveCount(0);
    });
});

// sendNote —— 像人一样填那张表并提交。每次进 /gate 折叠都会收起来，所以每封都先展开。
async function sendNote(page: Page, i: number): Promise<void> {
  const open = page.getByRole('button', { name: /write a note/i });
  if (await open.isVisible()) {
    await open.click();
  }
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/access-requests'),
    { timeout: 15_000 },
  );
  await page.getByTestId('request-name').fill(`Lock Copy ${i}`);
  await page.getByTestId('request-email').fill(`lock-copy-${i}@example.invalid`);
  await page.getByTestId('request-message')
    .fill(`note number ${i}: asking for a code to talk about the audit`);
  await page.getByTestId('request-submit').click();
  await answered;
}
