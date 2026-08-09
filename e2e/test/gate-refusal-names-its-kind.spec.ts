// gate-refusal-names-its-kind.spec.ts —— F-D-6:每一种拒绝要说出自己那一类。
//
// 拿着码的人,「打错字」和「被 owner 吊销」该做的事是**相反**的:前者重新粘一次,后者别再试、
// 去要一张新的。而 gate 对这两种回的是同一句 `access code invalid or revoked` —— 两种人都不
// 知道下一步。
//
// 分支在数据层就没了:`codes_query.go` 的 GetByCode 只查 active,于是「被吊销」和「不存在」
// 都是 no-rows,收敛成同一个 ErrCodeInvalid。所以这不是文案没写好,是那句话**永远写不出来**。
//
// 这条从 GUI 走,读访客真正看到的那句 —— 后端回什么 code 是实现细节,访客看到的是措辞。
//
// 满员那一种已经是对的(`this code is full`),一并断住:它是这条 item 点名要防的那一类
// (「有效邀请被报成坏码」),不能在修吊销那条时被顺手合并回去。
//
// RED(修复前):吊销那条读到的是跟不存在完全相同的句子 → 第二个 test 红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'refusal@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'refusal',
  fullName: 'Refusal Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const LIVE_CODE = 'REFUSE-LIVE';
const REVOKED_CODE = 'REFUSE-GONE';
const FULL_CODE = 'REFUSE-FULL';

let seeded: { request: APIRequestContext; csrf: string } | null = null;

test.beforeAll(async ({ playwright }) => {
  // 装配里有一次真开会话(占掉那个唯一名额),而开会话要串行冷启沙箱 —— 新实例上远超默认的
  // 30s hook 上限。放宽的是**前置条件**的时间,不是断言的时间。
  test.setTimeout(180_000);
  seeded = await setup(playwright);
});

test.afterAll(async () => {
  await seeded?.request.dispose();
});

test.describe('gate · every refusal names its own kind (F-D-6)', () => {
  test('a code that does not exist says so', async ({ page }) => {
    const msg = await refusalFor(page, 'NOSUCH-999', 'Stranger');
    expect(msg, 'an unknown code must be reported as unknown').toMatch(/invalid|unknown|no such/i);
  });

  test('a revoked code does not read the same as an unknown one', async ({ page }) => {
    const unknown = await refusalFor(page, 'NOSUCH-998', 'Stranger');
    const revoked = await refusalFor(page, REVOKED_CODE, 'Holder');

    // 断「两句不一样」,而不是断某个具体措辞 —— 措辞是产品的选择,「分得出来」才是不变量。
    expect(
      revoked,
      'a revoked code and an unknown code must not read identically — '
      + 'one means retype it, the other means ask for a new one',
    ).not.toBe(unknown);
    // 而且要说得出「撤销」这件事,不能只是换个说法的同一个意思。
    expect(revoked, 'the revoked case must name revocation').toMatch(/revok|withdraw|no longer/i);
  });

  test('a full code is still reported as full, not as a bad code', async ({ page }) => {
    // 这一条是 item 点名要防的那一类:有效邀请被报成坏码。修吊销那条时不许把它合并回去。
    const msg = await refusalFor(page, FULL_CODE, 'SecondSeat');
    expect(msg, 'a full code must say it is full').toMatch(/full/i);
  });
});

// refusalFor —— 在 gate 上填码 + 名字、提交,回读访客看到的那句拒绝。
async function refusalFor(page: Page, code: string, name: string): Promise<string> {
  await goto(page, '/gate');
  await page.getByTestId('gate-code').fill(code);
  await page.getByTestId('gate-visitor-name').fill(name);
  await page.getByTestId('gate-code-submit').click();
  // gate-error 在页面上不止一处(code 面板 / request 面板各一),收窄到 code 面板里那条。
  const err = page.getByTestId('code-panel').getByTestId('gate-error');
  await expect(err, 'the gate must show a refusal').toBeVisible({ timeout: 10_000 });
  return (await err.innerText()).trim();
}

async function setup(playwright: Playwright): Promise<{ request: APIRequestContext; csrf: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: LIVE_CODE, label: 'live' });
  // 满员:名额 1,先用掉。
  await createCode(request, csrf, { code: FULL_CODE, label: 'full', max_members: 1 });
  await enterOnce(request, FULL_CODE, 'FirstSeat');
  // 吊销:建出来再撤。
  const gone = await createCode(request, csrf, { code: REVOKED_CODE, label: 'gone' });
  const res = await request.post(`${BACKEND}/api/admin/codes/${gone.id}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`revoke: ${res.status()}`);
  return { request, csrf };
}

// enterOnce —— 占掉一个名额(走发码会话接口,不必开浏览器)。
async function enterOnce(request: APIRequestContext, code: string, name: string): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    data: { handle: OWNER.handle, mode: 'code', code, visitor_name: name },
  });
  if (res.status() !== 200) throw new Error(`seat: ${res.status()}`);
}
