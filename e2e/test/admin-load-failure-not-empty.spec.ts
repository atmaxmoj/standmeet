// admin-load-failure-not-empty.spec.ts —— 加载失败**不许**渲染成一句权威的空话。
//
// 这条守的是一整类，不是一个点。规矩本身早就写在 `use-latest-list.ts` 里：
//   「加载失败别静默成空列表：空 vs『没拉到』owner 得分得清」
// 三处没守它，全都是 `.catch(() => set<空>())`：GET 挂了，组件照样按「取到了，且是空的」渲染。
//
// 为什么这是**真 bug** 而不是洁癖：空态在这几处都是**owner 会当真去信的一句陈述**。
//   - code 卡：「(role grants nothing)」—— 读起来是「这张码什么都读不到」，一个**看起来安全**的谎。
//     owner 据此以为已经锁死了，于是不去收窄。真相是 GET 500 了，role 授的一切照读。
//   - dashboard：「0 sent」/ 空的 recent visitors —— 读起来是「没这回事」，而不是「没拉到」。
// 静默的方向恰好指向「不用管」，所以它不会被 owner 发现 —— 只会被相信。
//
// 发现经过（本 spec 的由来）：prod 上 `GET /codes/{id}/corpus` 每张码都 500（DB 卷比新表老），
// 而 GUI 上**一个错都看不见**，六张卡整整齐齐写着「(role grants nothing)」。控制台里才有 500。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'loadfail@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'loadfail',
  fullName: 'Load Failure Owner',
};

// LIES —— 每句都是某个 `.catch(() => set<空>())` 会印出来的、owner 会当真的陈述。
const GRANTS_NOTHING = /role grants nothing/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · a failed load must not render as an authoritative empty', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code corpus: a 500 does not become “(role grants nothing)”', corpusLoadFailure);
  test('code corpus: a 500 surfaces to the owner', corpusLoadFailureIsVisible);
  test('dashboard: a 500 does not become “0 sent”', dashboardCountLoadFailure);
});

// fail —— 把某个 admin GET 钉死成 500（真实故障的确定性替身：prod 上它是缺表）。
async function fail(page: Page, glob: string | RegExp): Promise<void> {
  await page.route(glob, (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'boom' } }),
  }));
}

// corpusLoadFailure —— RED（修复前）：catch 把 loaded 设成 true，granted 留空 → 卡片印出
// 「(role grants nothing)」。那句话是错的，且错在**让人放心**的方向。
async function corpusLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  await fail(adminPage, '**/api/admin/codes/*/denials');
  await gotoAdminSection(adminPage, 'codes');
  await expect(adminPage.getByTestId('code-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText(GRANTS_NOTHING),
    'the fetch failed — claiming the role grants nothing is a lie, and one the owner would trust',
  ).toHaveCount(0);
}

// corpusLoadFailureIsVisible —— 光是「不说谎」不够：owner 得知道这里没拉到，否则控制盘上少了
// 一块而无人察觉。断言的是**好结果**（错误在场），不是「没崩」。
async function corpusLoadFailureIsVisible({ adminPage }: { adminPage: Page }): Promise<void> {
  await fail(adminPage, '**/api/admin/codes/*/denials');
  await gotoAdminSection(adminPage, 'codes');
  await expect(adminPage.getByTestId('code-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText(/couldn’t load|could not load/i).first(),
    'the owner must be told this control failed to load',
  ).toBeVisible({ timeout: 10_000 });
}

// dashboardCountLoadFailure —— 同一类的第二处。真正的吞在 `dashboard-fetch.ts` 的
// `if (!res.ok) return 0`：500 根本不抛，组件的 catch 收不到，「0 sent」就这么印出去了。
//
// 断言的是**好结果**（'—' = 没拉到），不是「不等于 0」—— 后者在 fetch 回来之前就满足了，会在
// bug 还在的时候瞬间绿掉（本条第一版正是如此）。'—' 只由 error 态产生，loading 是 '…'。
async function dashboardCountLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  let intercepted = 0;
  await adminPage.route(/\/api\/admin\/applications/, (route) => {
    intercepted += 1;
    return route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'boom' } }),
    });
  });
  // 整页重载，而不是"点去别处再点回来"。adminPage 落地时就已经拉过一次 count（那一发早于 route
  // 注册，拿到真值 0），而 Next 的客户端路由会把那个 segment 连同它的 state 一起复用 —— 兜一圈
  // 回来看到的还是那个 0。这条 case 一度是绿的，只因为第一发还没 resolve 就被导航走了；等 codes
  // 页变慢（挂上 picker 之后），它就够时间 resolve 了，于是同一段测试代码开始红。
  // 时序决定成败的断言 = 迟早会骗人的断言。reload 之后什么都不剩，route 必然生效。
  await adminPage.reload();
  // 先证「这一发真的被钉成 500 了」。否则一个没拦到的请求会让断言红在完全无关的地方 ——
  // 本条第一版就是那样：它以为自己在测吞错误，其实测的是"这实例恰好 0 份 application"。
  await expect.poll(() => intercepted, {
    message: 'the applications GET must actually be intercepted — otherwise this asserts nothing',
  }).toBeGreaterThan(0);
  await expect(
    adminPage.getByTestId('dash-applications-sent'),
    'a failed count must read as unknown (—), never as a confident zero',
  ).toHaveText('—', { timeout: 10_000 });
}

// initOwner —— 必须**真发一张码**：没有码就没有 corpus 卡，case 1 会在 bug 还在的时候绿掉
// （找不到「(role grants nothing)」不是因为它没被印出来，是因为整页压根没有卡）。这条 spec 的第一版
// 就是这么假绿的。role 也**故意授了东西** —— 否则「role grants nothing」碰巧是真话，断言又白做。
async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'granted', description: 'grants real corpus', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: 'LOADFAIL-001', label: 'loadfail', assumed_role_id: role.id,
  });
  await request.dispose();
}
