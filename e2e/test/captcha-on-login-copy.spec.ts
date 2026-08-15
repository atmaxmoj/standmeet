// captcha-login-copy.spec.ts —— F-G-5：人机校验没过，不能被说成「密码不对」。
//
// `login_guard.go` 的顺序是 限流 → captcha → 凭据，captcha 这一关**短路在凭据校验之前**，
// 而它写的信封是 `invalid credentials`。于是密码**完全正确**的 owner，只要那道校验没加载出来
// （网络被挡、Cloudflare 抖、拦截插件），得到的也是「密码不对」——他会去改密码，
// 而真因在另一个地方。
//
// 「防枚举所以要含糊」在这里不成立：密码错 vs 用户不存在要含糊，是为了不泄露账号是否存在；
// 「人机校验没过」不是账号预言机，说出来不泄露任何东西。同一个文件里限流那条分支就说了真话
// （"too many login attempts, try again later"），对照就在旁边。
//
// 只能在 captcha 真开着时驱 —— 走 `make test-captcha`（Cloudflare 测试密钥）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'captcha-copy@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'captchacopy',
  fullName: 'Captcha Copy Owner',
};

test.describe('login · a failed human check must not be reported as a wrong password', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
  });
  test.afterAll(async () => { await request.dispose(); });

  test('the RIGHT password with no captcha token is not called "invalid credentials"',
    async () => {
      // 密码是对的 —— 这条用例的全部意义就在这里：被拒的原因是那道校验，不是凭据。
      const res = await request.post(`${BACKEND}/api/admin/login`, {
        data: { email: OWNER.email, password: OWNER.password },
      });
      expect(res.status(), 'a missing human check still refuses the login').toBe(401);

      const body = await res.text();
      expect(
        body.toLowerCase(),
        'the owner typed the right password — telling them it is invalid sends them to reset it, '
          + 'and the real cause (the human check) is never named',
      ).not.toContain('invalid credentials');
      expect(
        body.toLowerCase(),
        'the refusal has to name the human check, the way the rate-limit branch names the limit',
      ).toMatch(/human check|captcha|verification/);
    });
});
