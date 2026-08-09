// dashboard-requests-kpi.spec.ts —— F-C-19:dashboard 的 REQUESTS 数字要跟真实待处理请求数一致。
//
// 它数的是 `status === 'new'`,而后端产出的是 `'open'`(领域词表 `'open' | 'replied' | 'closed'`,
// `'new'` 从来不存在)。于是这块 KPI **恒为 0** —— 有多少条待处理都一样。
//
// 0 是个看起来完全正常的数字,副标题还替它圆场（「at zero · from gate」读起来像「确实没人来」）,
// 所以这一类只有把**同一份数据的两个面摆在一起**才看得出来:侧栏徽标数 `'open'`,数对了。
//
// 判据是**两个面必须一致**,而不是「等于 1」—— 前者在以后请求数变了、或者又多一个面时仍然成立。
// 先断非空(真有一条待处理),否则「两边都是 0」也会让一致性断言通过,那是空集的假绿。
//
// RED(修复前):侧栏 1、dashboard 0 → 不一致,红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'kpi@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'kpiowner',
  fullName: 'KPI Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await submitAccessRequest(request);
  await request.dispose();
});

test.describe('dashboard · the REQUESTS figure counts real pending requests (F-C-19)', () => {
  test('the dashboard tile agrees with the sidebar badge', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'dashboard');

    const badge = adminPage.getByTestId('badge-requests');
    // 非空守卫:先证明真的有一条待处理,否则「两边都是 0」会让下面的一致性断言假绿。
    await expect(badge, 'guard: one request really is pending').toHaveText('1', { timeout: 10_000 });

    const tile = adminPage.getByTestId('kpi-requests');
    await expect(
      tile,
      'the dashboard REQUESTS figure must match the pending requests the sidebar counts',
    ).toContainText('1');
  });
});

// submitAccessRequest —— 从 gate 的 no-code 路径投一条请求(走公开接口,不必开浏览器)。
async function submitAccessRequest(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/access-requests`, {
    data: {
      name: 'Dana Whitfield',
      org: 'Northwind Labs',
      email: 'dana@example.com',
      message: 'I would like to talk about verification harnesses.',
    },
  });
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`access-request: ${res.status()} ${await res.text()}`);
  }
}

export type { Playwright };
