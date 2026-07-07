// recovery-phrase.spec.ts —— #100 account recovery phrase.
//
// 忘记密码时的自助恢复:owner 登录时生成一条高熵 recovery phrase → 只存 hash → 明文邮到 owner 邮箱
// (走已配的 mail connector,SMTP 凭据不出 vault)。锁在外面时:公开 /recover 端点收 {email, phrase},
// 对上 hash → 直接发一个 owner session(登进去改密码)。单次用 —— 用过即作废。公开端点 brute-force
// 面,套 login-guard 限速。
//
// RED(实现前):/account/recovery 与 /recover 都不存在 → 404 → 断言红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo,
} from '@/fixtures/mail';

const OWNER = {
  email: 'recover-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'recoverowner',
  fullName: 'Recover Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// extractPhrase —— 从 recovery 邮件正文里抠出 phrase。生成端把 phrase 放在一行 `phrase: <...>`。
function extractPhrase(body: string): string {
  const m = body.match(/phrase:\s*([A-Za-z0-9-]+)/);
  return m ? m[1]! : '';
}

async function generateRecovery(request: APIRequestContext, csrf: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/account/recovery`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return res.status();
}

async function recover(
  request: APIRequestContext, email: string, phrase: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/recover`, {
    data: { email, recovery_phrase: phrase },
  });
  return res.status();
}

async function meStatus(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BACKEND}/api/admin/me`);
  return res.status();
}

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await configureMailConnector(request, OWNER.email, OWNER.password);
  await request.dispose();
});

test.describe('account recovery phrase · #100', () => {
  test('generate → phrase emailed to owner; recover with it → logged in', async ({ playwright }) => {
    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await clearMailpit(admin);

    expect(await generateRecovery(admin, csrf), 'generate → 200').toBe(200);
    const mail = await waitForMailEnvelopeTo(admin, OWNER.email);
    const phrase = extractPhrase(mail.text);
    expect(phrase.length, 'recovery phrase emailed to owner').toBeGreaterThan(10);
    await admin.dispose();

    // 锁在外面:全新 context(无 session),只有 email + phrase。
    const stranger = await playwright.request.newContext();
    expect(await meStatus(stranger), 'baseline: not logged in').toBe(401);
    expect(await recover(stranger, OWNER.email, phrase), 'recover with right phrase → 200').toBe(200);
    expect(await meStatus(stranger), 'recovered → session works').toBe(200);
    await stranger.dispose();
  });

  test('wrong phrase rejected; used phrase is single-use', async ({ playwright }) => {
    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await clearMailpit(admin);
    await generateRecovery(admin, csrf);
    const mail = await waitForMailEnvelopeTo(admin, OWNER.email);
    const phrase = extractPhrase(mail.text);
    await admin.dispose();

    const stranger = await playwright.request.newContext();
    expect(await recover(stranger, OWNER.email, 'not-the-phrase-xxxx'), 'wrong phrase → 401').toBe(401);
    expect(await recover(stranger, OWNER.email, phrase), 'right phrase → 200').toBe(200);
    // 单次用:同一条 phrase 第二次不认。
    const again = await playwright.request.newContext();
    expect(await recover(again, OWNER.email, phrase), 'reused phrase → 401').toBe(401);
    await stranger.dispose();
    await again.dispose();
  });
});
