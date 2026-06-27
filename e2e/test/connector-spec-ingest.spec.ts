// connector-spec-ingest.spec.ts —— #155 区 A（spec 摄入）RED 契约。
//
// 故事：owner 在 /admin/connectors 点 "add" → 贴 / 上传一份 OpenAPI spec →
// 后端解析 → 显示一条「connector candidate」（品类 + 派生表单入口）。这是
// spec-driven 装配的第一步：把任意作者搓的 spec 喂进来。摄入是错误/边界面
// 最大的区——畸形 JSON、非 3.0 版本（2.0/3.1）、缺 servers/operations、URL
// 拉取失败，都要在 UI 上给 owner 人类可读的拒绝理由，不漏栈、不静默吞。
//
// 对齐 docs/design/connector.md §8 区 A + 目标接口草图：
//   testid: connector-add-open / connector-spec-input(粘贴或上传) /
//           connector-spec-submit / connector-spec-error / connector-candidate /
//           connector-spec-url-input / connector-spec-fetch-button
//   REST:   POST /api/admin/connectors（从 spec 建）
//
// 全 test.fixme —— 摄入 UI/后端从零，实现后逐条转绿。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// claimOwner —— beforeAll 前置：复位实例 + claim owner（两个 describe 共用）。
async function claimOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

test.describe('connector · 区A spec 摄入 · happy', () => {
  // 红契约：spec-driven 摄入 UI/后端未建（docs/design/connector.md §8 区 A）。实现后去掉。
  test.fixme(true, 'pending #155: connector OpenAPI spec ingest');

  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // happy —— 合法 OpenAPI 3.0 贴进去 → 解析成功 → calendar candidate 出现。
  test('合法 3.0 spec 粘贴 → 解析 → 显示 calendar connector candidate', async ({
    adminPage: page,
  }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(validCalendarSpec());
    await page.getByTestId('connector-spec-submit').click();

    const candidate = page.getByTestId('connector-candidate');
    await expect(candidate).toBeVisible();
    // 解析出标题/品类，给 owner 确认这就是要装的那个。
    await expect(candidate).toContainText(/calendar/i);
    await expect(page.getByTestId('connector-spec-error')).toHaveCount(0);
  });

  // happy —— 同一份 spec 走「上传文件」入口（贴 vs 上传两条路同结果）。
  test('合法 3.0 spec 文件上传 → 解析 → candidate 出现', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').setInputFiles({
      name: 'calendar.openapi.json',
      mimeType: 'application/json',
      buffer: Buffer.from(validCalendarSpec(), 'utf-8'),
    });
    await page.getByTestId('connector-spec-submit').click();
    await expect(page.getByTestId('connector-candidate')).toContainText(/calendar/i);
  });
});

test.describe('connector · 区A spec 摄入 · err', () => {
  // 红契约：spec-driven 摄入 UI/后端未建（docs/design/connector.md §8 区 A）。实现后去掉。
  test.fixme(true, 'pending #155: connector OpenAPI spec ingest');

  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // err —— 畸形（非法 JSON / 截断）→ 拒，给「无法解析」级别的人类可读错误。
  test('畸形 spec → 拒绝 + 人类可读 parse 错误（不显示候选）', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill('{ "openapi": "3.0.0", ');
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/parse|invalid|无法解析|格式/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— Swagger 2.0 → 拒，错误必须明确点出版本（决策：只收 3.0）。
  test('非 3.0（Swagger 2.0）→ 拒 + 版本提示', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(swagger20Spec());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/3\.0|version|版本/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— 3.1 也拒（只收 3.0，3.1 schema 模型不同，不通吃）。
  test('非 3.0（OpenAPI 3.1）→ 拒 + 版本提示', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(openapi31Spec());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/3\.0|version|版本/i);
  });

  // err —— 没有 servers → 拒（runtime 拿不到 base URL，无法调 API）。
  test('缺 servers → 拒 + 指出缺 servers', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specMissingServers());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/servers/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— 有 servers 但 paths 为空（无 operations）→ 拒（没东西可绑定）。
  test('无 operations（paths 空）→ 拒 + 指出缺 operations', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specMissingOperations());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/operation|path/i);
  });

  // err —— 给 spec URL 但拉取失败（不可达/404）→ UI 报 fetch 失败，不卡死。
  test('spec URL 拉取失败 → 人类可读 fetch 错误', async ({ adminPage: page }) => {
    await openConnectorAdd(page);
    // 切到「从 URL 拉 spec」入口。
    await page.getByTestId('connector-spec-url-input')
      .fill('http://127.0.0.1:9/does-not-exist.openapi.json');
    await page.getByTestId('connector-spec-fetch-button').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/fetch|unreachable|failed|拉取|无法/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 本地 helper（实现落地后提升为共享 fixture：openConnectorAdd / openSpecPaste +
// 样例 spec 串）。
// ──────────────────────────────────────────────────────────────────────────

// openConnectorAdd —— 从已知入口 nav 进 connectors 区并打开 add（不 page.goto）。
async function openConnectorAdd(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  await page.getByTestId('connector-add-open').click();
}

// openSpecPaste —— 打开 add 后确保「粘贴/上传 spec」输入可见。
async function openSpecPaste(page: Page): Promise<void> {
  await openConnectorAdd(page);
  await expect(page.getByTestId('connector-spec-input')).toBeVisible();
}

// validCalendarSpec —— 最小合法 OpenAPI 3.0 calendar spec（servers + freebusy
// operation + securitySchemes，足够派生表单 + 候选品类）。
function validCalendarSpec(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Acme Calendar', version: '1.0.0' },
    servers: [{ url: 'https://calendar.acme.test/v1' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          security: [{ oauth2: ['calendar.read'] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://calendar.acme.test/oauth/authorize',
              tokenUrl: 'https://calendar.acme.test/oauth/token',
              scopes: { 'calendar.read': 'read', 'calendar.write': 'write' },
            },
          },
        },
      },
    },
  });
}

// swagger20Spec —— Swagger 2.0（`swagger: "2.0"`，无 `openapi`）→ 必拒。
function swagger20Spec(): string {
  return JSON.stringify({
    swagger: '2.0',
    info: { title: 'Old API', version: '1.0.0' },
    host: 'api.acme.test',
    basePath: '/v1',
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// openapi31Spec —— OpenAPI 3.1（`openapi: "3.1.0"`）→ 只收 3.0，必拒。
function openapi31Spec(): string {
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Future API', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// specMissingServers —— 合法 3.0 但无 `servers` → runtime 无 base URL，拒。
function specMissingServers(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'No Servers', version: '1.0.0' },
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// specMissingOperations —— 有 servers 但 `paths` 为空 → 无 operation 可绑定，拒。
function specMissingOperations(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'No Ops', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: {},
  });
}
