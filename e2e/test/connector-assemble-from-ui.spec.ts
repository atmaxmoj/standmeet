// connector-assemble-from-ui.spec.ts —— #155 契约（已实现，绿）：owner 在 admin UI 里把一个
// 连接器从零连起来——挑「calendar」品类 → 点 Connect → 走 OAuth → 卡片显示 Connected。
//
// spec-driven 连接器 UI 装配流已实现，本测真编译、真跑、真绿（原为 RED 目标契约，实现后转绿）。
//
// 设计要点（provider-agnostic）：connector 是**品类**（"calendar"，booker Requires 认的
// 名），背后 provider 真 prod 是 Google/Outlook/CalDAV，e2e 里用 mock（gcal.ts 已有 mock
// OAuth 流 + /api/admin/connectors/.../{init,status,disconnect} —— 复用，不新建）。所以本测
// 跟真 Google 无关；真 Google 要真账号、归 #107/#108 手验。
//
// 闭环后续（连上 → DepRegistry 据 Requires:["calendar"] 放行 → calendar_book 解闸装配，正是
// #154 booker 卡的那洞）单独加一条断言；本测先钉「从 UI 连上」这条主路径。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector · assemble a connector from the admin UI', () => {
  // 覆盖 spec-driven 连接器 UI 装配流（docs/design/connector.md §8）。已实现，绿。

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // adminPage fixture 自己跑完 owner 登录，给一个已进 admin 的 page。
  test('owner clicks Connect on /admin/connectors to wire up calendar → shows Connected', async ({
    adminPage: page,
  }) => {
    // adminPage 落在 admin；从已知入口点 nav 进 connectors 区（不 page.goto）。
    await page.getByTestId('admin-nav-connectors').click();

    // connectors 区列出品类；calendar 那条是「有 Connect 按钮」的连接器行（booker 能力行
    // 没 Connect，借此跟 capability-row-calendar.book 区分开）。未连。
    const card = page.getByRole('listitem')
      .filter({ hasText: /calendar/i })
      .filter({ has: page.getByRole('button', { name: /connect|连接/i }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(/not connected|未连接/i)).toBeVisible();

    // owner 在卡里填自己的 OAuth client 凭据（就是 ui 填写，无 env fallback）。
    await card.getByTestId('connector-field-client_id').fill('mock-client-id');
    await card.getByTestId('connector-field-client_secret').fill('mock-client-secret');

    // 点 Connect → OAuth 流（mock）→ 回 connectors 区。
    await card.getByRole('button', { name: /connect|连接/i }).click();
    await page.waitForURL('**/admin/connectors**');

    // 装配成功：卡片现在 Connected。
    await expect(card.getByText(/connected|已连接/i)).toBeVisible();
  });
});
