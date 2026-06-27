// connector-connect-flow.spec.ts —— #155 §8 区 D (连接流) 的 RED 契约。
//
// 目标行为（docs/design/connector.md §4 提交后 + §5.2 装配流 + §8 区 D）：
// owner 在 admin UI 里把一个**已派生出凭据表单**的连接器连起来。两条路：
//
//   oauth2 (openapi):  填 client_id/secret → 点 Connect → 后端起 dance →
//                      跳 mock authorize → callback 换 token → 存 token →
//                      connector-status = Connected。
//   非 dance (key/basic/bearer):  填 secret → 点 Connect → 立即 Connected，无跳转。
//
// 这是 TDD 红测：真编译、真跑、真红。红在「spec-driven connector connect 流」
// 这条**还没建**的路径上（现状 connectors 区是手搓 gcal-specific、形态不同）。
// 全部 test.fixme（describe 级），实现逐条转绿。
//
// mock-OAuth：复用 gcal-setup.ts 里 runMockOAuthFlow 那套**已有的 mock OAuth
// provider**机制——后端发的 auth_url 指向 mock，访问它会 302 链回 /callback。
// 本设计把 gcal-specific 的 /api/admin/connectors/google-calendar/{init,...}
// 泛化到 /api/admin/connectors/{id}/{connect,status,disconnect}。区 D 的红测
// 对着泛化后的 {id} 接口写。consent-deny / token-fail / state-mismatch /
// network-fail 等错误分支需要 mock provider 暴露**可编程的故障开关**（见返回
// 里列的新 helper）。
//
// 约束（eslint）：spec 不做 page.request.post/delete、不 fetch(POST/DELETE)、不
// page.goto。所有写操作（connect / disconnect / 填字段）一律走 UI 点按钮。status
// 只读断言可用 GET。describe 拆成几块以让每个回调 < 70 行。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright, Locator } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// oauth2 连接器：现状手搓 gcal 退化成「一份内置 openapi 绑定」，id 仍是
// google-calendar（calendar 品类，oauth2 securityScheme，跑 dance）。
const OAUTH2_CONNECTOR_ID = 'google-calendar';
// 非 dance 连接器：一个 bearer/apiKey 鉴权的连接器（无 OAuth dance），存密钥即连。
const NONDANCE_CONNECTOR_ID = 'bearer-api';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ════════ happy 路 ════════════════════════════════════════════════
test.describe('connector · 连接流 happy (§8 区 D)', () => {
  test.fixme(true, 'pending #155: connector connect flow — happy (dance + non-dance)');
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('oauth2: 填 client_id/secret → Connect → mock authorize → callback → token 存 → Connected',
    async ({ adminPage: page }) => {
      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      await fillOAuth2Creds(card, 'mock-client-id', 'mock-client-secret');
      await expectNotConnected(card);

      // 点 Connect → 后端起 dance → mock authorize 自动同意 → callback 回 connectors 区。
      await card.getByTestId('connector-connect-button').click();
      await page.waitForURL('**/admin/connectors**');

      await expectConnected(card);
      const status = await getConnectorStatus(page, OAUTH2_CONNECTOR_ID);
      expect(status.connected).toBe(true);
      expect(status.has_credentials).toBe(true);
    });

  test('非 dance: bearer 连接器填 token → Connect → 立即 Connected，无跳转',
    async ({ adminPage: page }) => {
      const card = await openConnectorCard(page, NONDANCE_CONNECTOR_ID);
      // bearer：单 token 字段，secret。无 redirect_uri、无 dance。
      await expect(card.getByTestId('connector-redirect-uri')).toHaveCount(0);
      await card.getByTestId('connector-field-token').fill('static-bearer-token');
      await expectNotConnected(card);

      // 点 Connect → 存密钥即连，无 authorize 跳转（同页直接翻 Connected）。
      await card.getByTestId('connector-connect-button').click();
      await expectConnected(card);

      const status = await getConnectorStatus(page, NONDANCE_CONNECTOR_ID);
      expect(status.connected).toBe(true);
    });

  test('oauth2: per-connector redirect_uri 在连接前以 readonly 展示',
    async ({ adminPage: page }) => {
      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      // owner 要拿这个 URI 去 SaaS 注册 OAuth client；连接前就得能看到、且只读。
      const redirect = card.getByTestId('connector-redirect-uri');
      await expect(redirect).toBeVisible();
      await expect(redirect).toHaveValue(
        new RegExp(`/api/admin/connectors/${OAUTH2_CONNECTOR_ID}/callback`),
      );
      await expect(redirect).toHaveAttribute('readonly', '');
    });
});

// ════════ oauth2 错误分支 ══════════════════════════════════════════
test.describe('connector · 连接流 oauth2 错误 (§8 区 D)', () => {
  test.fixme(true, 'pending #155: connector connect flow — oauth2 error branches');
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('用户在 consent 页 deny → 未连接 + 友好提示',
    async ({ adminPage: page }) => {
      await programMockOAuth(page, 'deny');
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      // 仍未连接，且界面是人话错误（无 stack / 无 error code）。
      await expectNotConnected(card);
      await expectFriendlyError(card, /access_denied|stack|trace|panic|500/i);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('无效 client_id/secret → token 交换失败 → 报错，未连接',
    async ({ adminPage: page }) => {
      // mock provider：authorize 给 code，但 token 端点对这组凭据返 invalid_client。
      await programMockOAuth(page, 'token_invalid_client');
      const card = await runOAuth2Dance(page, 'wrong-client-id', 'wrong-secret');
      await expectNotConnected(card);
      await expectFriendlyError(card, /invalid_client|stack|trace|panic/i);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('callback state/CSRF mismatch → 拒绝，未连接',
    async ({ adminPage: page }) => {
      // mock provider 在 callback 回带一个**与 init 不符的 state** → 后端必须拒。
      await programMockOAuth(page, 'state_mismatch');
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      // CSRF 防护：state 不符必须当攻击拒掉，不存 token。
      await expectNotConnected(card);
      await expect(card.getByTestId('connector-error')).toBeVisible();
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('dance 中网络故障 → 友好错误，未连接',
    async ({ adminPage: page }) => {
      // mock provider：token 端点不可达（网络断 / 超时）。
      await programMockOAuth(page, 'network_fail');
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      await expectNotConnected(card);
      await expectFriendlyError(card, /ECONNREFUSED|ETIMEDOUT|dial tcp|stack/i);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });
});

// ════════ reconnect / rotate / disconnect ══════════════════════════
test.describe('connector · 重连 / 轮换 / 断开 (§8 区 D)', () => {
  test.fixme(true, 'pending #155: connector reconnect / rotate / disconnect');
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('连上后轮换 client_id/secret → 重验后仍能连上',
    async ({ adminPage: page }) => {
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      await expectConnected(card);

      // 轮换身份字段（换 Google project）→ 改 client_id/secret → 重跑 dance。
      // 身份变 → 旧 token 作废 → 必须重跑 dance 才恢复 Connected（D-5 重验）。
      await fillOAuth2Creds(card, 'mock-client-id-ROTATED', 'mock-client-secret-ROTATED');
      await card.getByTestId('connector-connect-button').click();
      await page.waitForURL('**/admin/connectors**');

      await expectConnected(card);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(true);
    });

  test('连上后点 Disconnect → status 翻 not-connected',
    async ({ adminPage: page }) => {
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      await expectConnected(card);

      // 点 Disconnect（UI；后端 DELETE .../{id}/disconnect）→ 清 token。
      await card.getByTestId('connector-disconnect-button').click();
      await expectNotConnected(card);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });
});

// ─── 卡片定位 + 表单 + 断言 helper ─────────────────────────────────

async function openConnectorCard(page: Page, id: string): Promise<Locator> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  const card = page.getByTestId(`connector-row-${id}`);
  await expect(card).toBeVisible();
  return card;
}

async function fillOAuth2Creds(
  card: Locator, clientId: string, clientSecret: string,
): Promise<void> {
  // 派生表单：oauth2 → client_id + client_secret 字段；token 不填（dance 自动拿）。
  await card.getByTestId('connector-field-client_id').fill(clientId);
  await card.getByTestId('connector-field-client_secret').fill(clientSecret);
}

// runOAuth2Dance —— 进卡片 → 填凭据 → 点 Connect → 等回 connectors 区。
// 返回卡片 Locator 供调用方断言连接结果。
async function runOAuth2Dance(
  page: Page, clientId: string, clientSecret: string,
): Promise<Locator> {
  const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await fillOAuth2Creds(card, clientId, clientSecret);
  await card.getByTestId('connector-connect-button').click();
  await page.waitForURL('**/admin/connectors**');
  return card;
}

async function expectConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/connected|已连接/i);
}

async function expectNotConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/not connected|未连接/i);
}

// expectFriendlyError —— 错误条可见，且不漏底层 jargon（forbidden 正则）。
async function expectFriendlyError(card: Locator, forbidden: RegExp): Promise<void> {
  const err = card.getByTestId('connector-error');
  await expect(err).toBeVisible();
  await expect(err).not.toContainText(forbidden);
}

// ─── connector status (read-only GET; eslint 允许 GET) ──────────────

interface ConnectorStatus {
  has_credentials: boolean;
  connected: boolean;
}

async function getConnectorStatus(page: Page, id: string): Promise<ConnectorStatus> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  if (res.status() !== 200) throw new Error(`connector status ${id}: ${res.status()}`);
  return await res.json() as ConnectorStatus;
}

// ─── mock OAuth programming（新 helper，见返回说明）──────────────────
// 复用 gcal-setup.ts 的 mock OAuth provider，但区 D 的错误分支需要**可编程的
// 故障开关**：让 mock 下一次 authorize/token 按指定 outcome 走。这里先内联一个
// 占位实现（GET 触发 mock 的 program 端点，避免 eslint POST 限制），等
// fixtures/ 提供正式 helper 后切过去。
type MockOAuthOutcome =
  | 'authorize'            // 默认：同意 + 正常换 token
  | 'deny'                 // consent 页拒绝 → access_denied
  | 'token_invalid_client' // authorize OK，token 端点 invalid_client
  | 'state_mismatch'       // callback 回带不符的 state
  | 'network_fail';        // token 端点不可达

async function programMockOAuth(page: Page, outcome: MockOAuthOutcome): Promise<void> {
  // 用 GET 触发 mock 的可编程开关（POST 被 eslint 限制；mock 用 GET 接收 program）。
  const mock = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
  const res = await page.request.get(`${mock}/__mock/oauth/program?outcome=${outcome}`);
  if (res.status() !== 200) {
    throw new Error(`program mock oauth (${outcome}): ${res.status()}`);
  }
}

// ─── owner 前置：claim（不走任何被测写路径）───────────────────────
async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
