// connector-scope-readback.spec.ts —— F-C-33。**连上之后，owner 还看得见自己授了什么吗。**
//
// `connector-connect-flow.spec.ts` 有一条用例守**写**那一半：勾选的 scope 子集原样进 dance。
// 没有任何一条问过**读**那一半 —— 而 prod 上驱出来的正是它：`calendar · connected`，
// 底下两个 scope 勾选框**都是空的**，刷新之后照旧。
//
// 那不是「显示了旧值」。勾选框既没有 `checked` 也没有 `defaultChecked`，而 admin API 里
// 根本没有「这条连接授了哪些」这一项 —— 这一格**只能往里写、读不出来**。后果不只是难看：
// owner 想加一个 scope 时，屏幕上没有一个可信的起点，发出去的范围是什么也无从判断。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import {
  ensureDisconnected, expectConnected, fillOAuth2Creds,
  openConnectorCard, resetMockOAuthRecord, selectScope,
} from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'scoperead@example.com',
  password: 'scope-readback-pass-1',
  handle: 'scopereadowner',
  fullName: 'Scope Readback Owner',
};

const OAUTH2_CONNECTOR_ID = 'google-calendar';
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events';

// adminPage 用这份凭据登录 —— 不设的话它会拿默认的 alice 去登，而这个文件 claim 的是
// 上面这个 owner，于是 admin 壳根本进不去（表现成 `admin-nav-page` 等到超时）。
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-C-33 · a connection shows the scopes it was granted', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the granted scopes are still visible after leaving and coming back',
    async ({ adminPage: page }) => {
      const clientID = 'scope-readback-client-id';
      await resetMockOAuthRecord(page);
      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      await ensureDisconnected(card);
      await fillOAuth2Creds(card, clientID, 'mock-client-secret');
      // 授一个**子集**：READ 授、WRITE 不授。
      await selectScope(card, SCOPE_READ, true);
      await selectScope(card, SCOPE_WRITE, false);
      await card.getByTestId('connector-connect-button').click();
      await page.waitForURL('**/admin/connectors**');
      await expectConnected(card);

      // 离开这一页再回来 —— owner 隔天回来看到的就是这个。
      const back = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      await expectConnected(back);
      await expect(back.getByTestId(`connector-scope-${SCOPE_READ}`),
        'the scope this connector was actually granted still reads as granted')
        .toBeChecked();
      await expect(back.getByTestId(`connector-scope-${SCOPE_WRITE}`),
        'and one that was never granted does not')
        .not.toBeChecked();
    });
});
