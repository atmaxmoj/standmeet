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
// 覆盖 spec-driven connector connect 流（§8 区 D）。已实现，真编译、真跑、真绿
//（原为 RED 目标契约、describe 级 test.fixme，实现后已转绿去掉 fixme）。
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

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright, Locator } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
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

// oauth2 scope 多选：勾选子集断言用。READ 勾、WRITE 不勾。
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
// MOCK_API —— spec 里写给后端容器用的地址（docker 网络名 + SSRF 白名单）；MOCK 是浏览器/node 用的
// 宿主地址。同一个 mock（9000 宿主映射），一个名字三方解析不同，所以拆开。
const MOCK_API = process.env['MOCK_API_URL'] ?? 'http://external-mock:9000';
const DB_CONTAINER = 'standmeet-dev-db-1';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ════════ happy 路 ════════════════════════════════════════════════
test.describe.configure({ mode: 'serial' });
test.describe('connector · connect flow happy (§8 area D)', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('oauth2: fill client_id/secret → Connect → mock authorize → callback → token stored → Connected',
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

  test('non-dance: bearer connector fills token → Connect → immediately Connected, no redirect',
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

  test('oauth2: per-connector redirect_uri shown readonly before connecting',
    async ({ adminPage: page }) => {
      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      // owner 要拿这个 URI 去 SaaS 注册 OAuth client；连接前就得能看到、且只读。
      const redirect = card.getByTestId('connector-redirect-uri');
      await expect(redirect).toBeVisible();
      await expect(redirect).toHaveAttribute('readonly', '');

      // F-D-…/F-C-32：这一格的**唯一**用途是被粘进第三方控制台的 "Authorized redirect
      // URIs"，而那里只收**绝对**地址。这条断言以前写的是 `/api/admin/…/callback` ——
      // 把缺陷本身写成了判据：相对路径照样绿，改对了反而红。判据换成 URI 本身能不能成立。
      const value = await redirect.inputValue();
      expect(() => new URL(value),
        `the redirect URI must be absolute — a provider cannot register ${value}`)
        .not.toThrow();
      expect(new URL(value).protocol, 'the redirect URI is an http(s) URL')
        .toMatch(/^https?:$/);
      expect(new URL(value).pathname,
        'and it still points at this connector\'s callback')
        .toBe(`/api/admin/connectors/${OAUTH2_CONNECTOR_ID}/callback`);
    });

  // 仍 fixme：需 mock provider 暴露可编程的 authorize-scope 记录端点（/__mock/oauth/{reset,
  // last_authorize}）+ 后端把 owner 勾选的 scope 子集带进 dance。下个增量做。
  test('oauth2: owner-selected scope subset carried verbatim into the authorize dance',
    async ({ adminPage: page }) => {
      // §4：oauth2 的 scope 是多选；owner 勾哪些，dance 的 authorize URL 就
      // 必须只带哪些（既不偷加、也不漏带）。mock provider 记录它收到的 scope
      // param，断言对着 mock 的记录做 —— 而不是猜后端拼了什么字符串。
      // 独立 client_id：mock 的 authorize 记录按 client_id 存，这样并行跑的其它 oauth dance
      // （别的 spec，用 'mock-client-id'）不会污染本测试要读的 scope 记录。
      const clientID = 'scope-subset-client-id';
      await resetMockOAuthRecord(page);
      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      // 前面的 happy 用例可能已经把这个 connector 连上了；scope 复选框只在**未连接**的卡上出现。
      // 走 UI 断开（本文件的约定），让本用例从干净状态开始。
      await ensureDisconnected(card);
      await fillOAuth2Creds(card, clientID, 'mock-client-secret');

      // 勾一个**子集**（READ 勾、WRITE 不勾），故意漏掉表单里其余可选 scope。
      await selectScope(card, SCOPE_READ, true);
      await selectScope(card, SCOPE_WRITE, false);

      await card.getByTestId('connector-connect-button').click();
      await page.waitForURL('**/admin/connectors**');
      await expectConnected(card);

      // mock 录到的 authorize scope param 必须 === 勾选集合，不多不少。
      const requested = await getRecordedAuthorizeScopes(page, clientID);
      expect(requested).toContain(SCOPE_READ);
      expect(requested).not.toContain(SCOPE_WRITE);
    });
});

// ════════ oauth2 错误分支 ══════════════════════════════════════════
test.describe('connector · connect flow oauth2 errors (§8 area D)', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('user denies on the consent page → not connected + friendly message',
    async ({ adminPage: page }) => {
      await programMockOAuth(page, 'deny');
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      // 仍未连接，且界面是人话错误（无 stack / 无 error code）。
      await expectNotConnected(card);
      await expectFriendlyError(card, /access_denied|stack|trace|panic|500/i);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('invalid client_id/secret → token exchange fails → error, not connected',
    async ({ adminPage: page }) => {
      // mock provider：authorize 给 code，但 token 端点对这组凭据返 invalid_client。
      await programMockOAuth(page, 'token_invalid_client');
      const card = await runOAuth2Dance(page, 'wrong-client-id', 'wrong-secret');
      await expectNotConnected(card);
      await expectFriendlyError(card, /invalid_client|stack|trace|panic/i);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('callback state/CSRF mismatch → rejected, not connected',
    async ({ adminPage: page }) => {
      // mock provider 在 callback 回带一个**与 init 不符的 state** → 后端必须拒。
      await programMockOAuth(page, 'state_mismatch');
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      // CSRF 防护：state 不符必须当攻击拒掉，不存 token。
      await expectNotConnected(card);
      await expect(card.getByTestId('connector-error')).toBeVisible();
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('network failure mid-dance → friendly error, not connected',
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
test.describe('connector · reconnect / rotate / disconnect (§8 area D)', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('rotate client_id/secret after connecting → reconnects after re-verify',
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

  test('click Disconnect after connecting → status flips to not-connected',
    async ({ adminPage: page }) => {
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      await expectConnected(card);

      // 点 Disconnect（UI；后端 DELETE .../{id}/disconnect）→ 清 token。
      await card.getByTestId('connector-disconnect-button').click();
      await expectNotConnected(card);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(false);
    });

  test('Disconnect keeps client_id/secret → one-click reconnect without re-entering credentials',
    async ({ adminPage: page }) => {
      // 对齐 admin-gcal-disconnect「preserves credentials」：disconnect 只清
      // token，加密存的 client_id/secret 留着 → 下次 Connect 一键重跑 dance，
      // owner 不用再去翻 Google project 把 client_id/secret 抄一遍。
      const card = await runOAuth2Dance(page, 'mock-client-id', 'mock-client-secret');
      await expectConnected(card);

      await card.getByTestId('connector-disconnect-button').click();
      await expectNotConnected(card);
      // 凭据保留：status 仍 has_credentials；UI 字段也仍回填（masked）。
      const afterDisconnect = await getConnectorStatus(page, OAUTH2_CONNECTOR_ID);
      expect(afterDisconnect.has_credentials).toBe(true);

      // 不重填任何凭据，直接 Connect → dance 用保留的凭据跑通 → 重新 Connected。
      await card.getByTestId('connector-connect-button').click();
      await page.waitForURL('**/admin/connectors**');
      await expectConnected(card);
      expect((await getConnectorStatus(page, OAUTH2_CONNECTOR_ID)).connected).toBe(true);
    });
});

// ════════ generic openapi oauth2 连接器：token 静默刷新 (§8 区 D) ════
// 把 chat-book-token-refresh 的「过期 access token → 静默刷新 → 消费成功」
// 泛化到一个**owner 上传的** openapi oauth2 连接器（非 gcal 内置那条）。
// 连接走 UI dance；消费走 §8 接口草图的运行时直验 diag。
test.describe('connector · generic oauth2 token silent refresh (§8 area D)', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('uploaded oauth2 connector: access token expires → backend silently refreshes → runtime call succeeds',
    async ({ adminPage: page, playwright }) => {
      // 单独 authed 的 API 上下文：poll/diag 都是 admin 路由，需登录（page 的会话不共享给它）。
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      // owner 经品类装配视图上传 + 派生表单 + dance 连上一个 generic openapi oauth2 连接器（拿 id）。
      // initOwner 已清过 mock token 计数，故 dance 这次 authorization_code 换 token = 计数里的「初签」。
      const id = await assembleUploadedOAuth2(page, request);

      // 直接改库把该连接器的 access token 标记过期 → 逼下次运行时消费走刷新路径。
      expireUploadedAccessToken(id);

      // 触发一次运行时消费（diag list-busy）→ 后端发现 token 过期 → 静默刷新 → 用新 token 重试 →
      // 调用成功。mock token 端点被打到 >= 2 次（dance 初签 + 这次刷新）。
      const status = await diagListBusy(request, csrf, id);
      expect(status, 'runtime consume succeeds after silent refresh').toBe(200);
      const tokenCalls = await getMockTokenCallCount(request);
      expect(tokenCalls, 'token endpoint hit twice: initial + refresh').toBeGreaterThanOrEqual(2);
      await request.dispose();
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

// ensureDisconnected —— 若卡片当前是 connected，点 UI 的 disconnect 让它回到未连接。
// 幂等：未连接时按钮不在，直接返回。
async function ensureDisconnected(card: Locator): Promise<void> {
  const btn = card.getByTestId('connector-disconnect-button');
  await (await btn.count() > 0 ? btn.click() : Promise.resolve());
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

// expectConnected —— 锚定成**整串** 'connected'。原来写的是 /connected|已连接/i，而
// toHaveText 的正则不加锚点就是子串匹配 —— "not connected" 同样命中。那是一条不会红的断言：
// 未连接的卡片照样让它通过。
async function expectConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^(connected|已连接)$/i);
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

// ─── scope 多选 helper（新 testid：连接器派生表单里的 scope 勾选项）──────
// 假设 scope 在派生表单里渲染成可勾选项，testid = connector-scope-{scope}。
// 这是 §4「scope 多选」落到 UI 的形态；正式 testid 实现时定，红测先挂着。
async function selectScope(card: Locator, scope: string, checked: boolean): Promise<void> {
  const box = card.getByTestId(`connector-scope-${scope}`);
  if (checked) await box.check();
  else await box.uncheck();
}

// ─── mock OAuth 记录读取（GET；eslint 允许）──────────────────────────
// 复用 gcal mock 的可编程 OAuth provider，新增「记录上次 authorize 收到的
// scope param」+「token 端点命中计数」+「reset」。GET 触发，避开 POST 限制。

async function resetMockOAuthRecord(page: Page): Promise<void> {
  const res = await page.request.get(`${MOCK}/__mock/oauth/reset`);
  if (res.status() !== 200) throw new Error(`reset mock oauth record: ${res.status()}`);
}

// getRecordedAuthorizeScopes —— mock 记录的、本次 authorize 请求里 scope
// param 拆出来的 scope 列表。断言「勾选子集被原样带进 dance」对着它做。
async function getRecordedAuthorizeScopes(page: Page, clientID: string): Promise<string[]> {
  // 按 client_id 读，隔离并行 oauth 测试（共享 mock 的 last_authorize 曾被别的 worker 的 dance 污染）。
  const res = await page.request.get(
    `${MOCK}/__mock/oauth/last_authorize?client_id=${encodeURIComponent(clientID)}`);
  if (res.status() !== 200) throw new Error(`last_authorize: ${res.status()}`);
  const body = await res.json() as { scopes?: string[] };
  return body.scopes ?? [];
}

// getMockTokenCallCount —— mock token 端点被命中的次数（初签 + 刷新计数）。
async function getMockTokenCallCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${MOCK}/__mock/oauth/token_call_count`);
  if (res.status() !== 200) throw new Error(`token_call_count: ${res.status()}`);
  return (await res.json() as { count: number }).count;
}

// ─── generic uploaded oauth2 连接器：上传 + dance + 运行时消费 helper ──────
// runUploadedOAuth2Dance —— 经 UI 上传 spec（connector-spec-input/submit）派生出
// oauth2 表单 → 填凭据 → Connect → dance → 回 connectors 区。返回卡片 Locator。
// assembleUploadedOAuth2 —— 经品类卡（calendar）的归一装配视图上传一个 generic openapi oauth2 日历
// 连接器（贴 {spec,binding} → 派生 oauth2 表单 → 选 scheme → 填凭据 → Connect → dance）。dance 整页
// 跳走再回，回程后轮询 GET /connectors 拿到该 connected 连接器的 id 返回。
async function assembleUploadedOAuth2(page: Page, request: APIRequestContext): Promise<string> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  await page.getByTestId('connector-add-open').click();
  await page.getByTestId('connector-card-calendar').click();
  // spec 和 binding 现在是两个框(F-C-21 之后只剩一份实现:目录层那个真表单)。以前这里往
  // 一个框里塞整块 `{spec, binding}` JSON —— 那是品类卡下面那个**第二个**表单的形状,它已经没了。
  await page.getByTestId('connector-spec-input').fill(JSON.stringify(UPLOADED_OAUTH2_SPEC));
  await page.getByTestId('connector-binding-input').fill(JSON.stringify(UPLOADED_OAUTH2_BINDING));
  await page.getByTestId('connector-spec-submit').click();
  await expect(page.getByTestId('connector-candidate')).toBeVisible();
  // 这份 spec 只声明 oauth2 一个方案 → **不出选择器**（§7 决策#3：多于一个才出）。装配送的
  // auth_scheme 取派生表单里的第一个，也就是 oauth2。以前这里要选一下，是因为当时选的其实是
  // 装配**之后** ConnectorCard 上那个（那个单方案也渲染）；现在方案是建连接器的入参，
  // 只有一个时它是确定的，没什么可选。
  await page.getByTestId('connector-field-client_id').fill('mock-client-id');
  await page.getByTestId('connector-field-client_secret').fill('mock-client-secret');
  // 装配 = 建连接器 + 把刚填的凭据存进去;随后摄入表单让位给这个连接器的卡,Connect 在卡上。
  await page.getByTestId('connector-assemble-button').click();
  await page.getByTestId('connector-connect-button').click();
  await page.waitForURL('**/admin/connectors**');
  return pollConnectedCalendarId(request);
}

// pollConnectedCalendarId —— dance 回程后轮询 GET /connectors，直到 calendar 品类有 connected 连接器，
// 返回其 id（waitForURL 可能因「本就在 connectors 区」提前命中，故轮询落库）。
async function pollConnectedCalendarId(request: APIRequestContext): Promise<string> {
  let id = '';
  await expect.poll(async () => {
    const res = await request.get(`${BACKEND}/api/admin/connectors`);
    if (res.status() !== 200) return false;
    const rows = (await res.json() as {
      connectors?: { id: string; category: string; connected: boolean }[];
    }).connectors ?? [];
    const hit = rows.find((c) => c.category === 'calendar' && c.connected);
    if (hit) id = hit.id;
    return Boolean(hit);
  }, { timeout: 15_000 }).toBe(true);
  return id;
}

// expireUploadedAccessToken —— 把这个连接器的 access token 标记过期（同 chat-book-token-refresh 直改
// 库手法），按 connector id 命中，逼下一次运行时消费走刷新路径。表 owner_connectors，列 token_expires_at。
function expireUploadedAccessToken(id: string): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = '${id}'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' });
}

// diagListBusy —— §8 接口草图的运行时直验。后端那三条按品类写死的 diag 路由收成了一条
// 通用 `/invoke`（见 fixtures/connector-diag.ts）；这里只保留"返 HTTP 状态"这个签名。
async function diagListBusy(request: APIRequestContext, csrf: string, id: string): Promise<number> {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return (await diagInvoke(request, csrf, id, 'calendar', 'free_busy',
    { time_min: now.toISOString(), time_max: week.toISOString() })).status;
}

// UPLOADED_OAUTH2_SPEC —— 一个 generic（非 gcal 内置）openapi oauth2 calendar 连接器：servers/token
// 指 MOCK_API（后端打），authorize 指 MOCK（浏览器跳）。归 calendar 品类（binding）好让 list-busy 可
// 经 diag 消费——刷新路径跟内置 gcal 同一套 runtime，归一。
const UPLOADED_OAUTH2_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Generic OAuth2 calendar', version: '1.0.0' },
  servers: [{ url: `${MOCK_API}/__mock/gcal` }],
  paths: {
    '/freeBusy': { post: { operationId: 'freebusy.query', responses: { '200': { description: 'ok' } } } },
    '/events': { post: { operationId: 'events.insert', responses: { '200': { description: 'ok' } } } },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: `${MOCK}/__mock/gcal/authorize`,
            tokenUrl: `${MOCK_API}/__mock/gcal/token`,
            scopes: { [SCOPE_READ]: 'read', [SCOPE_WRITE]: 'write' },
          },
        },
      },
    },
  },
} as const;

const UPLOADED_OAUTH2_BINDING = {
  category: 'calendar', kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      response: 'calendars.primary.busy.{ "start": start, "end": end }',
    },
    create_event: {
      op: 'events.insert',
      request: '{ "summary": summary, "start": { "dateTime": start }, "end": { "dateTime": end } }',
      response: '{ "id": id, "url": htmlLink }',
    },
  },
} as const;

// ─── owner 前置：claim（不走任何被测写路径）───────────────────────
async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  // 清掉上个 describe 编程的 dance 结局（mock OAuth 是进程级全局，否则会泄漏到下个 describe）。
  await request.get(`${MOCK}/__mock/oauth/reset`);
  await request.dispose();
}

// diagInvoke —— 打 owner-authed 的连接器 diag 口。**这是一条绕过真实链路的后门**
// (真实路径是 访客 chat → agent → booker 沙箱 → connector.invoke)，所以它**故意**
// 内联在这里、不抽成共用 fixture:抽出去等于给"绕过"发许可证,下一个人就更容易用它。
// 这条后门本身的去留见 task「diag 后门」。
async function diagInvoke(
  request: APIRequestContext, csrf: string, id: string,
  category: string, op: string, args: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const res = await request.post(
    `${BACKEND}/api/admin/diag/connector/${encodeURIComponent(id)}/invoke`,
    { headers: { 'X-Csrftoken': csrf }, data: { category, op, args } },
  );
  return { status: res.status(), text: await res.text() };
}
