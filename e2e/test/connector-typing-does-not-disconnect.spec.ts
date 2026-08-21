// connector-typing-does-not-disconnect.spec.ts —— F-C-46。
//
// **往凭据框里打一个字，不该把还在用的连接器放倒。**
//
// prod 上撞到的：驱 mail-connector 的 check 4 时，我的脚本只往 `from_address` 里 `type` 了
// 一次就断了 —— **CONNECT 一次都没点**。日志里两次 `POST /connectors/smtp/credentials`，
// 库里 `connected_at` 变成 NULL，而同一屏的卡还写着 connected。也就是说：**owner 刚开始
// 改密码，发信就已经停了** —— 批准申请发码、预约确认信，全挂在这条连接上。
//
// 两行各自都对，凑在一起才是缺陷：
//   · `use-connector-card.ts` 的 `setField` —— 每一次按键都往服务端存一遍；
//   · `svc_creds.go` 的 `ResetConnected: changed` —— 凭据真变了就清 connected（D-5：改身份
//     必须重新验证，F-C-30 定的）。
// 错的是**提交点**：存被绑在击键上，于是「我想改一下」和「我改完了」在服务端是同一件事。
//
// 这条用例有**两半**，缺一不可 —— 今天在同一个模块上刚吃过一次「闸门比缺陷粗，顺手把做得到的
// 动作也拿掉了」（[[gate-granularity-removes-working-action]]）：
//   1. 只打字不提交 → 服务端状态**不许动**（这是红的那一半）；
//   2. 改完真的按 CONNECT → 照旧重新验证（正对照：修法不许把 D-5 一起拿掉）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { openConnectorCard, expectConnected } from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'typing@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'typing',
  fullName: 'Typing Owner',
};

// bearer-api —— 非 dance 的内置连接器：一个 token 字段，存即连。身份字段只有一个，
// 「改身份」这件事在它身上最干净。
const CONNECTOR_ID = 'bearer-api';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.configure({ mode: 'serial' });
test.describe('connector · typing is not committing (F-C-46)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('typing a new credential does NOT take the live connector down', async ({ adminPage: page }) => {
    const card = await openConnectorCard(page, CONNECTOR_ID);
    await card.getByTestId('connector-field-token').fill('the-working-token');
    await card.getByTestId('connector-connect-button').click();
    await expectConnected(card);
    // 前置：它现在是连着的。
    expect((await status(page)).connected, 'precondition: the connector is live').toBe(true);

    // owner 开始改这个字段 —— 只是打字，没有按下任何东西。
    await card.getByTestId('connector-field-token').fill('half-typed-new-tok');

    // **离开这一屏再回来**，等于给「打字触发的那笔存」一个确实落地的机会。
    // 直接 `expect.poll` 读状态是不行的：poll 第一次就为真就通过 —— 而缺陷版本里那一笔
    // 还在路上，于是一条永远绿的断言（[[assertion-that-cannot-fail]]，今天第二次）。
    await openConnectorCard(page, 'smtp');
    const back = await openConnectorCard(page, CONNECTOR_ID);

    // 服务端仍然连着：这条连接还在用，凭据什么时候换由 owner 说了算。
    expect(
      (await status(page)).connected,
      'typing without committing must not take the live connection down',
    ).toBe(true);
    await expectConnected(back);
  });

  test('pressing Connect after a credential change still re-verifies (D-5 holds)',
    async ({ adminPage: page }) => {
      const card = await openConnectorCard(page, CONNECTOR_ID);
      // 不依赖上一条用例留下的状态：它正在钉的就是「状态会不会被打字改掉」，
      // 拿它的结局当自己的前提，等于让两条用例一起红或一起绿（[[two-guards-dying-at-one-line]]）。
      await card.getByTestId('connector-field-token').fill('the-working-token');
      await card.getByTestId('connector-connect-button').click();
      await expectConnected(card);
      // 正对照：真提交一次改动，D-5 那条重验必须照旧发生 —— 这一半防的是「修得太狠」。
      await card.getByTestId('connector-field-token').fill('a-different-token');
      await card.getByTestId('connector-connect-button').click();
      await expectConnected(card);
      const after = await status(page);
      // 提交之后重新验证过，仍然是连着的；新凭据真的存下去了。
      expect(after.connected, 'a committed change re-verifies and stays connected').toBe(true);
      expect(after.has_credentials, 'the new credential was actually stored').toBe(true);
    });
});

interface ConnectorStatus {
  has_credentials: boolean;
  connected: boolean;
}

async function status(page: Page): Promise<ConnectorStatus> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors/${CONNECTOR_ID}/status`);
  if (res.status() !== 200) throw new Error(`connector status: ${res.status()}`);
  return await res.json() as ConnectorStatus;
}
