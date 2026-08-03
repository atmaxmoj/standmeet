// connector-mail-rotate-creds-reverify.spec.ts —— §三 D-5 行
// 「改身份字段：mail 换 SMTP 发件邮箱/host/密码」(edit-config) → connected=false →
// 依赖 smtp 的能力(can_deliver_codes)隐藏 → 重跑连接测试才恢复。
//
// Identity-field change re-verify (decision D-5): changing the SMTP from_address /
// host is an identity change → backend resets connected=false (UpsertConnectorCredentials
// clears connected_at) → the smtp-dependent capability (can_deliver_codes on
// /api/v1/instance) flips false until the owner re-runs the connection test.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { configureMailConnector, saveMailCreds, connectMail } from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'mailrotate@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mailrotate',
  fullName: 'Mail Rotate Owner',
};

// 与 MAIL_FROM 不同的新身份字段 —— owner 换了发件邮箱(identity field)。
const ROTATED_FROM = 'rotated-noreply@standmeet.test';

async function canDeliverCodes(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  if (res.status() !== 200) throw new Error(`instance: ${res.status()}`);
  return (await res.json() as { can_deliver_codes: boolean }).can_deliver_codes;
}

test.describe('connector · mail rotate SMTP identity → re-verify (§3 D-5)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    // save creds → connect(test) → activate → connected = can_deliver_codes true.
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test('connected → change from_address → connected resets, can_deliver_codes false; re-connect restores',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // precondition: connected, so the smtp-dependent feature is on.
      expect(await canDeliverCodes(request)).toBe(true);

      // owner changes the SMTP identity (from_address) → resets connected.
      await saveMailCreds(request, csrf, { from_address: ROTATED_FROM });

      // smtp-dependent capability drops until re-verified.
      expect(await canDeliverCodes(request)).toBe(false);

      // re-run the connection test → restores the capability (slot still active).
      expect(await connectMail(request, csrf)).toBe(200);
      expect(await canDeliverCodes(request)).toBe(true);

      await request.dispose();
    });
});
