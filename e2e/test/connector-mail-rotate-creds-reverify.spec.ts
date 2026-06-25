// connector-mail-rotate-creds-reverify.spec.ts —— §三 D-5 行
// 「改身份字段：mail 换 SMTP 邮箱/host/密码」(edit-config) → verified=false →
// 依赖 smtp 的能力(can_email_codes)隐藏 → 重走 OTP 才恢复。
//
// RED / TDD：依赖「身份字段变 → 重置 verified」逻辑落地后才转绿。现状 saveMailCreds
// 二次写不重置 verified，本 spec 期望 can_email_codes 翻 false。
//
// Identity-field change re-verify (decision D-5): changing the SMTP from_address /
// host is an identity change → backend MUST reset verified=false → the smtp-dependent
// capability (can_email_codes on /api/v1/instance) flips false until the owner
// re-runs the OTP roundtrip.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  configureMailConnector, sendMailOTP, verifyMailOTP, readMailOTP,
} from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'mailrotate@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mailrotate',
  fullName: 'Mail Rotate Owner',
};

// 与 MAIL_FROM 不同的新身份字段 —— owner 换了发件邮箱(identity field)。
const ROTATED_FROM = 'rotated-noreply@standmeet.test';
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mailpit';
const SMTP_PORT = 1025;

async function canEmailCodes(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  if (res.status() !== 200) throw new Error(`instance: ${res.status()}`);
  return (await res.json() as { can_email_codes: boolean }).can_email_codes;
}

// saveMailCredsWith —— 写 mail 凭据但用自定义 from_address(改身份字段)。
async function saveMailCredsWith(
  request: APIRequestContext, csrf: string, fromAddress: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/mail/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      host: SMTP_HOST, port: SMTP_PORT, username: '', password: '',
      from_address: fromAddress, from_name: 'StandMeet',
    },
  });
  if (res.status() !== 200) throw new Error(`mail credentials: ${res.status()}`);
}

test.describe('connector · mail rotate SMTP identity → re-verify (§三 D-5)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    // 完整 OTP roundtrip → verified=true → can_email_codes=true。
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test('verified → change from_address → verified resets, can_email_codes false; re-OTP restores',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // precondition: verified, so the smtp-dependent feature is on.
      expect(await canEmailCodes(request)).toBe(true);

      // owner changes the SMTP identity (from_address) → must reset verified.
      await saveMailCredsWith(request, csrf, ROTATED_FROM);

      // smtp-dependent capability drops until re-verified.
      expect(await canEmailCodes(request)).toBe(false);

      // re-run the OTP roundtrip → restores the capability.
      await sendMailOTP(request, csrf);
      const code = await readMailOTP(request, OWNER.email);
      const status = await verifyMailOTP(request, csrf, code);
      expect(status).toBe(200);
      expect(await canEmailCodes(request)).toBe(true);

      await request.dispose();
    });
});
