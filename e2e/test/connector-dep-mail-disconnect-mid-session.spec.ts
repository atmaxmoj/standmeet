// connector-dep-mail-disconnect-mid-session.spec.ts —— 状态变更矩阵
// 「mail 断联 · 两 turn 间 · 依赖 smtp 的能力隐藏」补(mid-session,补 mail-connector
// 只测 fresh 的缺口)。
//
// 依赖 smtp connector 的能力这里取 owner.can_email_codes(gate 的 request-access
// 邮件回路靠它),它在每次 /api/v1/instance 请求重算 —— 跟 booking tool 走单点闸
// 同一个「Requires 未连即隐藏」的道理。流程:配 + verify mail → can_email_codes
// true(能力可用)→ owner 在两回合之间 disconnect mail → 下一回合 can_email_codes
// **翻 false**(能力消失),gate 的 request-access 块随之收起。
//
// RED:重构落地前 smtp-依赖能力若不经 global 单点闸 per-call 重算,disconnect 后
// 仍可能算 true → 断言失败,符合 TDD 预期。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { configureMailConnector } from '@/fixtures/mail';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'maildep@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'maildep',
  fullName: 'Mail Dep Owner',
};

interface InstanceView { can_email_codes: boolean }

async function canEmailCodes(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  if (res.status() !== 200) throw new Error(`instance: ${res.status()}`);
  return (await res.json() as InstanceView).can_email_codes;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector dep · mail disconnect between turns hides smtp-dependent capability', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('connected → can_email_codes true; owner disconnects mail → next turn it flips false',
    async ({ playwright, page }) => {
      const request = await playwright.request.newContext();

      // turn 1 (smtp 已连): 依赖 smtp 的能力可用。
      expect(await canEmailCodes(request), 'smtp connected → capability available').toBe(true);

      // owner 在两回合之间断开 mail connector。
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const dis = await request.post(`${BACKEND}/api/admin/connectors/smtp/disconnect`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(dis.status()).toBe(200);

      // 下一回合(重新查实例): Requires:[smtp] 不再满足 → 能力消失。
      expect(await canEmailCodes(request), 'smtp disconnected → capability hidden').toBe(false);
      await request.dispose();

      // 能力一消失,gate 的 request-access 块也应收起(用户可见面同步)。
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await expect(page.getByRole('button', { name: /write a note/i })).toHaveCount(0);
    });
});

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await configureMailConnector(request, OWNER.email, OWNER.password); // → connected
  await request.dispose();
}
