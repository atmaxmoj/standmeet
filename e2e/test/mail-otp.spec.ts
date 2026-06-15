// mail-otp.spec.ts —— SMTP connector verification via a real 6-digit email OTP.
//
// 老 /test 只发一封探针信、SMTP 不报错就标 connected —— 不证明 owner 真收到。
// 现在必须真发码到 from_address + 输对才 connected，错满 10 次作废。真服务
// (Mailpit 捕获 SMTP)，无 mock：码是从 Mailpit 真读出来的。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  saveMailCreds, sendMailOTP, readMailOTP, verifyMailOTP, clearMailpit,
} from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'mailotp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mailotp',
  fullName: 'Mail OTP Owner',
};

test.describe('mail connector OTP verification', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('wrong code rejected, correct code connects', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    await saveMailCreds(request, csrf); // resets connected + clears any otp
    await clearMailpit(request);
    await sendMailOTP(request, csrf);
    const code = await readMailOTP(request);

    expect(await mailConnected(request)).toBe(false); // sent, not verified yet

    // a wrong code is rejected AND tells the owner how many tries remain.
    const wrong = await request.post(`${BACKEND}/api/admin/connectors/mail/verify-otp`, {
      headers: { 'X-Csrftoken': csrf }, data: { code: wrongOf(code) },
    });
    expect(wrong.status()).toBe(400);
    expect(await wrong.text()).toMatch(/attempt\(s\) left/i);
    expect(await mailConnected(request)).toBe(false); // wrong code → still off
    expect(await verifyMailOTP(request, csrf, code)).toBe(200);
    expect(await mailConnected(request)).toBe(true); // correct → connected
    await request.dispose();
  });

  test('10 wrong attempts void the code (even the right one then fails)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await saveMailCreds(request, csrf); // fresh: connected=false, otp cleared
      await clearMailpit(request);
      await sendMailOTP(request, csrf);
      const code = await readMailOTP(request);

      for (let i = 0; i < 10; i++) {
        expect(await verifyMailOTP(request, csrf, wrongOf(code))).toBe(400);
      }
      // voided: the correct code no longer works, connector stays off.
      expect(await verifyMailOTP(request, csrf, code)).toBe(400);
      expect(await mailConnected(request)).toBe(false);
      await request.dispose();
    });
});

function wrongOf(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

async function mailConnected(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/admin/connectors/mail/status`);
  const body = await res.json() as { connected: boolean };
  return body.connected;
}
