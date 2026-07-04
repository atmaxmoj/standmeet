// security-code-bruteforce.spec.ts —— pentest / net-new。访问码是可猜的 LABEL-XXX,而
// 兑换路径(POST /api/v1/sessions + /codes/intro)本无失败锁定/captcha,唯一节流是
// fail-open 的 120/min/IP —— 可被全速暴力枚举拿到别人的 RoleSnapshot(corpus + 预约配额)。
//
// 契约(修复后成立):同一来源 IP 连续试**错**码,超阈值 → 锁定(429)/要 captcha,而不是
// 无限返 code_invalid。锁定按 IP,合法访客(带真码、干净 IP)不受牵连(不 self-DoS)。
// RED(实现前):无锁定,20 次错码全是普通 4xx,没有 429。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { OWNER, seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// postSessionAttempt —— 直接打 /sessions;X-Forwarded-For 模拟来源 IP(chi.RealIP 解它到
// RemoteAddr,clientIP 读它)。返 HTTP status。
async function postSessionAttempt(
  request: APIRequestContext, ip: string, code: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { 'X-Forwarded-For': ip },
    data: { handle: OWNER.handle, mode: 'code', code, visitor_name: 'v' },
  });
  return res.status();
}

test.describe('pentest · access-code brute-force lockout', () => {
  let seed: BaseSeed;
  let validCode = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const c = await createCode(seed.request, seed.csrf, { code: 'RECRUIT-BF1', label: 'bf' });
    validCode = c.code;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('N wrong codes from one IP → lockout (429), not unlimited code_invalid',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const statuses: number[] = [];
      for (let i = 0; i < 20; i++) {
        statuses.push(await postSessionAttempt(request, '198.51.100.7', `NOPE-${i}`));
      }
      expect(statuses.filter((s) => s === 429).length,
        'brute force must trip a lockout (429) — currently unlimited wrong guesses')
        .toBeGreaterThan(0);
      await request.dispose();
    });

  test('lockout is per-IP: a clean IP redeeming the VALID code is unaffected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // 先把攻击者 IP 打到锁定。
      for (let i = 0; i < 20; i++) {
        await postSessionAttempt(request, '198.51.100.8', `NOPE-${i}`);
      }
      // 另一个干净 IP 用真码兑换 → 仍成功(200),不被连坐锁定。
      const ok = await postSessionAttempt(request, '203.0.113.9', validCode);
      expect(ok, 'valid code from a clean IP still issues a session').toBe(200);
      await request.dispose();
    });
});
