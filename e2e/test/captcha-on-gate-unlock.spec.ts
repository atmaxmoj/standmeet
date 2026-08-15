// gate-captcha-unlock.spec.ts —— F-G-3：被 per-IP 锁住的访客，必须能用产品自己写明的那条出路。
//
// 后端**收**这个东西：`sessions.go` 的 `captcha_token`，`code_guard.go:56` 的
// `Locked = enabled && overThreshold && captchaFails` —— 一个通过校验的 token 就解锁。
// 而 `TurnstileWidget` 全仓只挂在 `LoginForm.tsx`（**owner 的登录页**）。于是访客手滑十次之后
// 被锁 15 分钟，屏幕上没有任何出路：能力在后端，脸没建（同 F-D-9 / F-N-4 一族）。
//
// **只能在 captcha 真开着时驱**：widget 只在实例发布了 site key 时渲染，而其余 spec 全跑在
// captcha 关的默认形态上（那也是产品出厂的样子）。所以这条走 `make test-captcha` —— 它用
// Cloudflare 官方**永远通过**的测试密钥把栈拉起来。那对密钥自己出票，没有谜题可解。
//
// 判据两条：
//   ① 锁住之后，gate 上出现 captcha；
//   ② 解出来的 token 一发就真解锁 —— 用**同一张真码**在锁前锁后各试一次，锁前被拒、
//      带票之后进得去。只断①的话，一个渲染出来但没接线的组件也能过（那正是这条缺陷的形状）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'captcha-gate@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'captchagate',
  fullName: 'Captcha Gate Owner',
};
const GOOD_CODE = 'LETMEIN-001';
// codeFailMax = 10（code_guard.go）。多敲两次，别卡在边界上。
const WRONG_TRIES = 12;

test.describe('gate · a locked visitor is offered the way out the backend already accepts', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: GOOD_CODE, label: 'letmein' });
    await request.dispose();
  });

  test('captcha on + locked out ⇒ the gate shows a captcha, and solving it lets a real code through',
    async ({ page }) => {
      await goto(page, '/gate');
      // 先证 captcha 真的开着 —— 否则下面「没有 widget」只是因为这台实例压根没配，
      // 那样这条 spec 会红在环境上而不是红在缺陷上（[[red-in-the-wrong-place]]）。
      await expect(
        page.getByTestId('gate-captcha'),
        'captcha must be configured for this spec — run it via `make test-captcha`',
      ).toHaveCount(0, { timeout: 5_000 });

      // 一直试错码，**直到闸落下来**。不是固定敲 12 次：锁上之后提交按钮就该禁用了
      // （见下），再敲就是往一个不会发请求的表单里打字，等到的只有超时。
      for (let i = 0; i < WRONG_TRIES && !(await locked(page)); i++) {
        await submitCode(page, `NOPE-${String(i).padStart(3, '0')}`);
      }

      // ① 锁住了 → gate 必须给出那条出路。
      await expect(
        page.getByTestId('gate-captcha'),
        'a locked visitor must be offered the captcha the backend accepts, not just refused',
      ).toBeVisible({ timeout: 15_000 });

      // ② 而且它要真接线：测试密钥自己出票，带着票用真码应当进得去。
      //
      // 等按钮从禁用变回可按 —— 那是**票到手**的可见信号。上一版一看见校验框就提交，
      // 于是票还没出来就发了空的，后端照旧 429：我在跟一个自己造的竞态赛跑，而产品
      // 那边访客也会撞上同一个（所以那一格现在真的禁用，不只是给测试看的）。
      await expect(
        page.getByTestId('gate-code-submit'),
        'while locked and unsolved, submitting must be blocked — otherwise the visitor keeps '
          + 'hitting the same 429 with no idea whether to wait or give up',
      ).toBeDisabled({ timeout: 10_000 });
      // 每次被拒之后输入框会抖一下再自己清空（`useShakeOnError`）。等它清完再打字 ——
      // 上一版在清空之前就填好了码，于是那个定时器把码抹掉，回车提交了个空串，
      // 请求压根没发出去。人也是等它清完才重打的。
      await expect(page.getByTestId('gate-code')).toHaveValue('', { timeout: 5_000 });
      await page.getByTestId('gate-code').fill(GOOD_CODE);
      await expect(
        page.getByTestId('gate-code-submit'),
        'once the captcha issues its token the gate must let the code through',
      ).toBeEnabled({ timeout: 30_000 });
      await submitCode(page, GOOD_CODE);
      await expect(
        page.getByTestId('session-strip'),
        'a solved captcha must actually lift the lock — a widget that renders but sends no token '
          + 'leaves the visitor exactly as stuck',
      ).toBeVisible({ timeout: 20_000 });
    });
});

// locked —— 闸落下来了没有：以「那道人机校验出现了」为准，因为那正是这条 check 要的
// 观察点本身。不用等，问一下当下的状态就走。
async function locked(page: Page): Promise<boolean> {
  return await page.getByTestId('gate-captcha').isVisible();
}

// submitCode —— 像人一样填码点确认，然后**等这一次提交真的有了回音**。
// 不用定时等：那既慢又会在机器忙的时候把「还没回来」当成「回来了」（[[timeout-is-not-proof-of-not-done]]）。
async function submitCode(page: Page, code: string): Promise<void> {
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/v1\/(sessions|codes\/intro)/.test(r.url()),
    { timeout: 15_000 },
  );
  // 敲回车而不是点按钮：每次被拒都会插进一行错误提示，把按钮挪走，于是点击卡在
  // 「element is not stable」上 —— 那是我在跟布局赛跑，不是产品的毛病。门上那句
  // 提示本来就写着 press enter，人也是这么做的。
  const field = page.getByTestId('gate-code');
  await field.fill(code);
  await field.press('Enter');
  await answered;
}
