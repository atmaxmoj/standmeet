// connector-upload-mgmt.spec.ts —— #155 区 G（上传/管理）RED 契约。
//
// 故事：owner 自托管，能在自己实例 UI 上传一份**自定义 spec + 绑定**（决策 §7.4
// 「owner 能在自己实例 UI 上传，无中心审核」），它进 connectors 列表、能装配、跟
// 内置连接器区分开；重名走覆盖确认；删除一个上传的连接器后，它填的那个品类 cap
// **复闸**（consumer 的 Requires 不再被满足 → 该 cap 行从可用态退回 hidden/gated）。
//
// 对齐 docs/design/connector.md §8 区 G + 目标接口草图：
//   testid: connector-add-open / connector-spec-input / connector-binding-input /
//           connector-spec-submit / connector-row-{category} / connector-origin-badge /
//           connector-overwrite-confirm / connector-delete-button / connector-status
//   REST:   POST /api/admin/connectors（从 spec 建）/ DELETE /api/admin/connectors/{id}
//
// 全 test.fixme —— 上传/管理 UI/后端从零，实现后逐条转绿。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector · 区G 上传 / 管理', () => {
  // 红契约：自托管 spec+绑定 上传/管理 UI 未建（docs/design/connector.md §8 区 G）。实现后去掉。
  test.fixme(true, 'pending #155: connector upload + management');

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // happy —— 上传自定义 spec + 绑定 → 出现在列表的 calendar 行 → 可装配（有 status）。
  test('上传自定义 spec+绑定 → calendar 行出现 → 可装配', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('connector-row-calendar');
    await expect(row).toBeVisible();
    // 装配入口在：未连时 status 为 not connected。
    await expect(row.getByTestId('connector-status')).toContainText(/not connected|未连接/i);
  });

  // happy —— 上传的连接器标「uploaded」来源，跟内置（builtin）区分开。
  test('上传 vs 内置：上传的连接器带 uploaded 来源徽章', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('connector-row-calendar');
    const badge = row.getByTestId('connector-origin-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/uploaded|自定义|上传/i);
    await expect(badge).not.toContainText(/built-?in|内置/i);
  });

  // err/edge —— 重名上传 → 弹覆盖确认；确认后该品类只剩一条（覆盖，不是叠加）。
  test('重名上传 → 覆盖确认 → 列表不重复', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());
    // 再传一份同品类 calendar 连接器 → 命中重名。
    await openConnectorAdd(page);
    await fillSpecAndBinding(page, validCalendarSpec(), calendarBinding());
    await page.getByTestId('connector-spec-submit').click();

    const confirm = page.getByTestId('connector-overwrite-confirm');
    await expect(confirm).toBeVisible();
    await confirm.click();

    // 覆盖：calendar 行仍只有一条。
    await expect(page.getByTestId('connector-row-calendar')).toHaveCount(1);
  });

  // happy —— 删除上传的连接器 → 它从列表消失，且它填的 calendar cap 复闸（hidden/gated）。
  test('删除上传连接器 → 行消失 + calendar cap 复闸隐藏', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('connector-row-calendar');
    await expect(row).toBeVisible();
    await row.getByTestId('connector-delete-button').click();
    // 删除确认（破坏性动作）。
    await page.getByRole('button', { name: /delete|remove|删除|确认/i }).click();

    // 行消失。
    await expect(page.getByTestId('connector-row-calendar')).toHaveCount(0);
    // cap 复闸：依赖 calendar 的能力（booker calendar.book）退回 gated/hidden。
    // 现状 capability-row-calendar.book 在连上时才解闸；删 provider → 重新 gated。
    const capRow = page.getByTestId('capability-row-calendar.book');
    await expect(capRow).toHaveCount(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 本地 helper（实现落地后提升为共享 fixture：openConnectorAdd / uploadConnector +
// 样例 spec / 绑定串）。
// ──────────────────────────────────────────────────────────────────────────

// openConnectorAdd —— 从已知入口 nav 进 connectors 区并打开 add（不 page.goto）。
async function openConnectorAdd(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  await page.getByTestId('connector-add-open').click();
}

// fillSpecAndBinding —— 把 spec 贴进 spec-input、绑定贴进 binding-input。
async function fillSpecAndBinding(
  page: Page, spec: string, binding: string,
): Promise<void> {
  await expect(page.getByTestId('connector-spec-input')).toBeVisible();
  await page.getByTestId('connector-spec-input').fill(spec);
  await page.getByTestId('connector-binding-input').fill(binding);
}

// uploadConnector —— 打开 add → 填 spec+绑定 → 提交 → 等列表里出现该品类行。
async function uploadConnector(
  page: Page, spec: string, binding: string,
): Promise<void> {
  await openConnectorAdd(page);
  await fillSpecAndBinding(page, spec, binding);
  await page.getByTestId('connector-spec-submit').click();
  await expect(page.getByTestId('connector-row-calendar')).toBeVisible();
}

// validCalendarSpec —— 最小合法 OpenAPI 3.0 calendar spec（servers + freebusy +
// events.insert operation + oauth2 securityScheme）。
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
      '/events': {
        post: {
          operationId: 'events.insert',
          security: [{ oauth2: ['calendar.write'] }],
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

// calendarBinding —— op→契约 绑定（YAML 文本），把 list_busy/create_event 映到
// freebusy.query / events.insert，request/response 用 JSONata（决策 §7.1）。
function calendarBinding(): string {
  return [
    'category: calendar',
    'kind: openapi',
    'operations:',
    '  list_busy:',
    '    op: freebusy.query',
    '    request: { timeMin: timeMin, timeMax: timeMax }',
    '    response: { busy: calendars.primary.busy }',
    '  create_event:',
    '    op: events.insert',
    '    request: { summary: title, start: { dateTime: start }, end: { dateTime: end } }',
    '    response: { id: id, url: htmlLink }',
  ].join('\n');
}
