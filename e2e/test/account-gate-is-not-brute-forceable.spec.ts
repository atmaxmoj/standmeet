// account-gate-is-not-brute-forceable.spec.ts —— 那道当前密码闸门本身要能扛住爆破。
//
// 缺陷（审计 2026-08-31）：`/api/admin/login` 和 `/api/admin/recover` 都挂了 `loginGuard`
// （每 IP 限速 + 等时响应，`routes/admin/claim.go:63`）。而 `/account/email` 和
// `/account/password` **一个都没挂**（`routes/admin/account.go:29-31`）。
//
// 有人会说这两条在 session 后面，攻击者得先有 session。**那正是问题所在** ——
// 当前密码闸门存在的全部理由就是"偷到 session 也不等于接管账号"。而现在偷到 session 的人
// 可以对着 `/account/password` 无限次、全速试密码，一次限速都不吃。
// 前门装了锁，里面那道保险柜的密码盘可以随便转。
//
// 判据：不断"某一次被拒了"——那本来就会被拒。断的是**连续错误之后这条路被挡住**，
// 而且挡法跟前门一致（同一个 loginGuard，不是另写一套）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const ATTEMPTS = 12;

const OWNER = {
  email: 'bruteforce@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'bruteforce',
  fullName: 'Bea Bruteforce',
};

async function guessPassword(
  request: APIRequestContext, csrf: string, guess: string,
): Promise<number> {
  const res = await request.patch(`${BACKEND}/api/admin/account/password`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: guess, new_password: 'whatever-the-attacker-wants-1' },
  });
  return res.status();
}

test.describe('account · the current-password gate is rate limited like the front door', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('a stolen session cannot grind the current-password gate at full speed',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // 攻击者手上有一个合法 session —— 这正是这道闸门要防的场景。
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const codes: number[] = [];
      for (let i = 0; i < ATTEMPTS; i += 1) {
        codes.push(await guessPassword(request, csrf, `guess-number-${i}`));
      }

      // 前面几次是 401/403（密码不对）；到某一次必须变成 429（被限速挡住）。
      // 断"出现过 429"而不是"最后一次是 429"—— 阈值是运维取舍，这里只要求它存在。
      expect(codes, `12 次全速猜测一次都没被挡：${codes.join(',')}`).toContain(429);

      // 而且被限速之后，**正确的密码也不该马上放行** —— 否则限速只是延后了成功，
      // 攻击者拿对了照样过。
      const afterBlock = await guessPassword(request, csrf, OWNER.password);
      expect(afterBlock).toBe(429);

      await request.dispose();
    });

  test('the same guard covers the email gate, not only the password gate',
    async ({ playwright }) => {
      // 两条路通向同一件事（改凭据）。只挡一条等于没挡
      // —— [[gate-after-early-return-is-walkable]]：换个入口就绕开。
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const codes: number[] = [];
      for (let i = 0; i < ATTEMPTS; i += 1) {
        const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
          headers: { 'X-Csrftoken': csrf },
          data: { current_password: `guess-number-${i}`, new_email: 'attacker@example.com' },
        });
        codes.push(res.status());
      }
      expect(codes, `email 那道闸门 12 次全速猜测没被挡：${codes.join(',')}`).toContain(429);
      await request.dispose();
    });
});
