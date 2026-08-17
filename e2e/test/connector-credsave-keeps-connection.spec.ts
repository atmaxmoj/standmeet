// connector-credsave-keeps-connection.spec.ts —— F-C-30 / F-C-34 的**同一个根**。
//
// 存一次凭据会把「已连接」抹掉：`owner_connectors.sql.go` 的 upsert 里带着
// `connected_at = NULL`，而 token / 凭据一个字节都没动。面板点 Connect 时**先** POST
// `/credentials` —— 于是「已连接」在授权还没开始之前就没了。走完的话由 SaveTokens 补回来，
// 走不完（owner 在同意页上返回、或者只是重存一次凭据）就永远是 NULL。
//
// 两处后果，我在 prod 上都看见了：
//   · F-C-30：徽标说 `not connected`，而同一张卡上的只读探针答 "The calendar answered —
//     0 busy blocks"。凭据活着、token 会刷新 —— **连接是好的，是那个标签在撒谎。**
//   · F-C-34：同一状态下点 test-send，得到的是 "no mail connector is set up yet —
//     connect one first"。因为「没有 active 连接器」正是映射成「还没配过」的那个条件
//     （`connector/slots.go:260`）。owner 被要求去做一件他刚做完的事。
//
// **一个字段同时被当成「授权流程走到哪了」和「这条连接能不能用」，两件事从此分不开。**
// 这条守卫断的是后者：**凭据还在、能用**的连接，不该因为又存了一次凭据就变成「没连」。
//
// 用 smtp 驱：它没有 dance，`connect` 就是一次真握手，所以「存一次凭据」这个动作是
// 唯一的变量 —— oauth2 那条路上还夹着跳转，分不干净。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  configureMailConnector, connectMailOutcome, mailConnectorStatus,
  saveMailCreds, saveMailCredsPartial,
} from '@/fixtures/mail';

// GOOD_PORT —— mock 中继真正在听的那个端口（跟 fixtures/mail.ts 的 SMTP_PORT 一致）。
// 这一格要的是「值没变、只是被碰过」，所以必须填对的那个号。
const GOOD_PORT = 1025;

const OWNER = {
  email: 'credsave@example.com',
  password: 'credsave-keeps-conn-1',
  handle: 'credsaveowner',
  fullName: 'Cred Save Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-C-30/34 · saving credentials does not un-connect a working connection', () => {
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

  test('a connected mail connector stays connected when its credentials are saved again',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const before = await mailConnectorStatus(request);
      expect(before.connected, 'setup: the connector is connected to begin with').toBe(true);

      // owner 打开卡片、又存了一次凭据（值一个字都没改）—— 面板点 Connect 时做的
      // 第一件事就是这个。真实里更常见的是「点了 Connect 又改主意」，效果相同。
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await saveMailCreds(request, csrf);

      const after = await mailConnectorStatus(request);
      expect(after.hasCredentials, 'the credentials are still there').toBe(true);
      expect(
        after.connected,
        'saving the same credentials must not report a working connection as disconnected',
      ).toBe(true);
      await request.dispose();
    });

  // F-C-35 —— 卡上逐字写着 "leave the fields blank to keep them"。实际是**碰过的留下、
  // 没碰过的删掉**：面板只发 owner 敲过的键，后端整体替换 `credentials_enc`。
  // owner 改一个端口，密码就没了 —— 而且全程不报错。
  //
  // 判据落在**连接还能不能用**上，不落在「请求返回 200」上：这一路每一步都返 200，
  // 那正是它悄无声息的原因。
  test('editing one field keeps the rest of the credentials',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // owner 打开卡片，只碰了 port 一格 —— 值甚至没变。面板发上去的就是这一个键。
      await saveMailCredsPartial(request, csrf, { port: String(GOOD_PORT) });

      // 其余六个字段必须还在：连接测试是唯一能证明这件事的东西（凭据本身永远不回显）。
      const outcome = await connectMailOutcome(request, csrf);
      expect(
        outcome.connected,
        'touching one field must not wipe the credentials the owner never touched',
      ).toBe(true);
      await request.dispose();
    });
});
