// connector-connect-receipt.spec.ts —— 点 Connect 说"连上了",必须真的写下了那一笔。
//
// `POST /connectors/{id}/connect` 走非 dance(bearer/apikey/basic)那条时,后端调
// `MarkConnectorConnected`,它是一条光秃秃的 UPDATE:
//
//     UPDATE owner_connectors SET connected_at = ... WHERE owner_id = $1 AND connector_id = $2
//
// **owner 还没有这一行时,更新命中 0 行,不报错**,于是 connect 返回 `connected: true` ——
// 一句谎话。卡片当场翻成 connected,而下一次 `GET /status` 说 false。owner 刷新一下,
// 连接就"自己断了"。
//
// 这一行什么时候不存在?**每一次全新安装。** 行是"存凭据"那一步建的,而面板里存凭据是
// fire-and-forget(`void adminAPI.postVoid(...)`),不挡 Connect —— owner 填完就点,
// 两个请求赛跑。库里已经有行的时候(跑过一遍的开发机)谁先谁后都无所谓,所以这条只在
// 干净库上翻车,看起来像"偶发"。它不是偶发,是**没有回执**。
//
// 两条断言分别钉住这件事的两半:
//   1. 根本没存过凭据 → Connect 不该说连上(写不下就得说写不下,而且要说人话)
//   2. 凭据还在路上就点了 Connect → 最终仍然真连上(面板得等自己那一笔落地)
//
// 判据都取**回程的 `/status`**,不只看卡片上那行字:这个 bug 的全部形态就是"字对、库不对"。
// 卡片文案单独断言时也用 `/^connected$/`——`/connected/` 连 "not connected" 都匹配,
// 那是一条不会红的断言。

import { test, expect } from '@/fixtures/test';
import type { Page, Locator } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'receipt@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'receipt',
  fullName: 'Receipt Owner',
};

// 非 dance 的内置连接器:bearer 鉴权,单 token 字段,存即连 —— 走的正是那条光秃秃的 UPDATE。
const CONNECTOR_ID = 'bearer-api';
const CREDS_URL = `**/connectors/${CONNECTOR_ID}/credentials`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.configure({ mode: 'serial' });
test.describe('connector · connect writes a receipt, not a claim', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('Connect with nothing filled in never reports connected', async ({ adminPage: page }) => {
    const card = await openConnectorCard(page, CONNECTOR_ID);
    await expectNotConnected(card);

    // 一个字都没填 → 从来没有过 credentials 请求 → 库里没有这一行。此时点 Connect:
    // 那条 UPDATE 命中 0 行。今天后端把它当成功,卡片翻 connected —— 这一步就已经错了。
    await card.getByTestId('connector-connect-button').click();

    // 真相在库里:没有行 = 没连上。卡片说什么都不算数。
    await expect.poll(
      async () => (await getConnectorStatus(page, CONNECTOR_ID)).connected,
      { message: 'connect must not mark a connector connected when it stored nothing' },
    ).toBe(false);
    await expectNotConnected(card);
    // 而且写不下去要说人话:owner 得知道下一步该干什么,不能只看到一个静默回滚的状态。
    await expect(card.getByTestId('connector-error')).toBeVisible();
  });

  test('Connect clicked while the credential save is still in flight still connects',
    async ({ adminPage: page }) => {
      // 把存凭据的回程扣在手里 —— 不用计时器:闸门由本用例显式放开。
      const gate = new Gate();
      await page.route(CREDS_URL, async (route) => {
        await gate.waited;
        await route.continue();
      });

      const card = await openConnectorCard(page, CONNECTOR_ID);
      await card.getByTestId('connector-field-token').fill('static-bearer-token');
      await expectNotConnected(card);

      // owner 填完立刻点 —— 存凭据这一笔还没落地。面板必须等自己那一笔,而不是抢在前面
      // 让后端对着一张不存在的行说"连上了"。
      await card.getByTestId('connector-connect-button').click();
      // 状态离开 "not connected" = 面板已经开始动作(修好后是 connecting…,坏的时候直接跳
      // connected)。两条路都会离开,所以这一步不会把用例吊死在闸门前。
      await expect(card.getByTestId('connector-status')).not.toHaveText(/^not connected$/i);
      gate.open();

      await expectConnected(card);
      await expect.poll(
        async () => (await getConnectorStatus(page, CONNECTOR_ID)).connected,
        { message: 'the card says connected — the database has to agree' },
      ).toBe(true);
    });
});

// Gate —— 一道由本用例显式放开的闸门(替代 sleep;spec 里禁计时器等待)。
class Gate {
  readonly waited: Promise<void>;
  private release: () => void = () => undefined;

  constructor() {
    this.waited = new Promise<void>((resolve) => { this.release = resolve; });
  }

  open(): void { this.release(); }
}

async function openConnectorCard(page: Page, id: string): Promise<Locator> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  const card = page.getByTestId(`connector-row-${id}`);
  await expect(card).toBeVisible();
  return card;
}

// expectConnected —— 锚定成整串 'connected'。不加锚点的话 "not connected" 也匹配,
// 这条断言就永远不会红。
async function expectConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^connected$/i);
}

async function expectNotConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^not connected$/i);
}

interface ConnectorStatus {
  has_credentials: boolean;
  connected: boolean;
}

async function getConnectorStatus(page: Page, id: string): Promise<ConnectorStatus> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  if (res.status() !== 200) throw new Error(`connector status ${id}: ${res.status()}`);
  return await res.json() as ConnectorStatus;
}
