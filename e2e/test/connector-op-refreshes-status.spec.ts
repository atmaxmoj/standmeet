// connector-op-refreshes-status.spec.ts —— F-C-45：**一张卡不能同时说两件相反的事。**
//
// 2026-08-20 在 prod 上真去 Google 账号页撤掉了授权，回来点卡上的探针。后端做得没错：
// 探针答 *"the calendar access was revoked — reconnect it to continue"*，库里当场
// `active=f`、`connected_at=NULL`，日志一条 WARN、零重试。**而那张卡右上角仍写着
// `connected`** —— 就在那句话正上方，刷新一次才追上。
//
// 这正是本模块 LOOK 第一条要防的：*"The card shows its true state … never a stale default
// from before the last action."* owner 读到的是自相矛盾的一屏，其中一句是假的。
//
// 修法**不按错误类别分叉**：连接状态的家在后端，卡只是在**动作之后去问一次**。
// 让每个 op 各自记得「我这类失败要通知卡片」的话，下一个 op 就会忘（[[structure-means-no-responsibility-class]]）。
//
// 两句断言，缺一不可：
//   1. 探针那句话还在（撤权的说法本来就是对的，别把它一起改没了）；
//   2. **同一屏上**状态已经变成 not connected —— 不许 reload。reload 一下当然会对，
//      而 owner 不会替产品刷新。

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { openConnectorCard, expectConnected } from '@/fixtures/connector-card';
import { revokeMockGCalToken } from '@/fixtures/gcal';
import { connectGCalOnExistingOwner, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const DB_CONTAINER = 'standmeet-dev-db-1';

const OWNER = {
  email: 'revokecard@example.com',
  password: 'revoke-card-pass-1',
  handle: 'revokecardowner',
  fullName: 'Revoke Card Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-C-45 · an op that finds the grant revoked updates the card it sits on', () => {
  let seed: BaseSeed | undefined;

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    seed = { request, csrf };
    await connectGCalOnExistingOwner(seed);
  });

  test.afterAll(async () => { await teardownSeed(seed); });

  test('the probe says revoked, and the status beside it stops saying connected',
    async ({ adminPage: page }) => {
      test.setTimeout(120_000);
      const card = await openConnectorCard(page, 'google-calendar');
      await expectConnected(card);

      // 撤权发生在 owner 看不见的地方（provider 那一侧），所以卡上什么都不会变 —— 直到
      // 下一次真的用到它。这就是那一刻。
      await revokeMockGCalToken(page.request);
      expireAccessToken();

      await card.getByTestId('connector-op-field-days').fill('3');
      await card.getByTestId('connector-op-run').click();

      await expect(card.getByTestId('connector-op-result'),
        'the probe still says what happened, in words the owner can act on')
        .toContainText(/revoked/i, { timeout: 30_000 });

      await expect(card.getByTestId('connector-status'),
        'and the card no longer claims to be connected — on this screen, without a reload')
        .toHaveText(/^(not connected|未连接)$/i, { timeout: 15_000 });
    });
});

// expireAccessToken —— 把 access token 推过期，下一次用日历的调用才会去刷新，
// 而刷新正是撞上 invalid_grant 的那一步。跟 chat-book-token-refresh 用同一把旋钮。
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  );
}
