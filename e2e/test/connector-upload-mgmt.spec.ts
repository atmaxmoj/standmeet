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
// 覆盖 §8 区 G 上传/管理 UI + 后端。已实现，绿（原为 RED 契约，实现后转绿）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector · area G upload / manage', () => {
  // 覆盖自托管 spec+绑定 上传/管理 UI（docs/design/connector.md §8 区 G）。已实现，绿。

  // 每 test 重置实例 + owner（连接器不跨 test 累积；overwrite/delete 断绝对状态要干净）。
  test.beforeEach(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // happy —— 上传自定义 spec + 绑定 → 出现在列表的 calendar 行 → 可装配（有 status）。
  test('upload a custom spec+binding → calendar row appears → assemblable', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('connector-row-calendar');
    await expect(row).toBeVisible();
    // 装配入口在：未连时 status 为 not connected。
    await expect(row.getByTestId('connector-status')).toContainText(/not connected|未连接/i);
  });

  // happy —— 上传的连接器标「uploaded」来源，跟内置（builtin）区分开。
  test('uploaded vs built-in: an uploaded connector carries the uploaded origin badge', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('connector-row-calendar');
    const badge = row.getByTestId('connector-origin-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/uploaded|自定义|上传/i);
    await expect(badge).not.toContainText(/built-?in|内置/i);
  });

  // err/edge —— 重名上传 → 弹覆盖确认；确认后该品类只剩一条（覆盖，不是叠加）。
  test('duplicate-name upload → overwrite confirm → list not duplicated', async ({ adminPage: page }) => {
    await uploadConnector(page, validCalendarSpec(), calendarBinding());
    // 再传一份同品类 calendar 连接器 → 命中重名。
    await openConnectorAdd(page);
    await fillSpecAndBinding(page, validCalendarSpec(), calendarBinding());
    await assembleFilledSpec(page);

    const confirm = page.getByTestId('connector-overwrite-confirm');
    await expect(confirm).toBeVisible();
    await confirm.click();

    // 覆盖：calendar 行仍只有一条。
    await expect(page.getByTestId('connector-row-calendar')).toHaveCount(1);
  });

  // happy —— 删除上传的连接器 → 它从列表消失，且它填的 calendar cap 复闸（hidden/gated）。
  test('delete an uploaded connector → row gone + calendar cap re-gated/hidden', async ({ adminPage: page }) => {
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

  // 不变量 —— 内置连接器（embed 数据）owner 不可删/改：DELETE/PUT 内置 id → 409 builtin_readonly。
  // 守住「ErrBuiltinReadonly 跟 ErrInvalidManifest 分开」这条：内置改不得是 409，不是「坏 manifest」400。
  test('built-in connector is read-only: delete/edit a built-in → 409', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    // google-calendar 是内置连接器（builtins/data/google-calendar，embed 进二进制）。
    const del = await request.delete(`${BACKEND}/api/admin/connectors/google-calendar`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(del.status(), 'DELETE a built-in connector → 409 builtin_readonly').toBe(409);
    const put = await request.put(`${BACKEND}/api/admin/connectors/google-calendar`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(validCalendarSpec()), binding: calendarBinding() },
    });
    expect(put.status(), 'PUT (edit) a built-in connector → 409 builtin_readonly').toBe(409);
    await request.dispose();
  });

  // F-C-47 —— **传得进来，连不上去。**
  //
  // ①🔴 真环境（prod）：经 owner MCP 建了一个 protocol(caldav) 连接器，后台
  // 「CONNECTORS YOU UPLOADED」里确实有它 —— 一行 `calendar [uploaded] [protocol] ·
  // not connected` 加一个 `×`，**就这些**。没有凭据框、没有 CONNECT、点不开。
  // 而这一节的导语自己写着 *"you can upload your own (OpenAPI / protocol) connector"*。
  //
  // ②🎯 三处都读过：`CatalogCards` 只按 `/connectors/catalog` 渲染（就三个内置）；
  // `ConnectorList.ConnectorRowItem` 只画品类/来源/kind/状态/删除；owner MCP 也没有存凭据的
  // op。**而后端是齐的** —— `/{id}/credential-form`、`/{id}/credentials`、`/{id}/connect`
  // 挂在 `/{id}` 那一组上，对任何 id 都在。缺的不是能力，是没有一个面把它接出来
  // （[[button-that-cannot-be-wired]]）。
  //
  // 判据要能判负：不断「有个表单」（一张空表单也能过），断**这份 spec 自己的认证方案**
  // 派生出来的那个字段 —— 它只可能来自后端按这个连接器算出来的凭据表单。
  test('an uploaded connector can be given credentials, not just listed (F-C-47)',
    ({ adminPage: page }) => uploadedRowTakesCredentials(page));

  // F-C-56：**没绑品类契约的连接器在列表里没有名字。**
  //
  // 卡名一直渲的是 `category`，而 GitHub 那种落不到 calendar/mail 上的厂商只有「暴露成
  // agent 工具」这一条路 —— 那条路不产生 category，于是它在
  // `CONNECTORS YOU UPLOADED` 里是一行只有 `uploaded` `openapi` 两个徽章的空框。
  // 传第二个的那一刻列表就不再可读：要给哪一条填凭据、删哪一条，屏幕上答不出来。
  //
  // 判据要能判负：不断「有字」（`uploaded` 那个徽章也是字），断**这份 spec 自己的
  // `info.title`** —— 那个串只可能来自这份文档。
  test('an uploaded connector with no category still says which vendor it is (F-C-56)',
    ({ adminPage: page }) => uncategorisedRowNamesTheVendor(page));
});

// uncategorisedRowNamesTheVendor —— 传一份**不带 binding**、勾了 expose 的 spec（GitHub 那类
// 厂商唯一走得通的路），然后看它在列表里叫什么。
async function uncategorisedRowNamesTheVendor(page: Page): Promise<void> {
  await openConnectorAdd(page);
  await expect(page.getByTestId('connector-spec-input')).toBeVisible();
  await page.getByTestId('connector-spec-input').fill(validCalendarSpec());
  // binding 留空 + 勾「开给访客的 AI」—— 无 binding 且没勾会被产品拒（needsBindingOrExpose）。
  await page.getByTestId('connector-spec-submit').click();
  await expect(page.getByTestId('connector-candidate')).toBeVisible();
  await page.getByTestId('connector-expose-agent-tools').check();
  await page.getByTestId('connector-assemble-button').click();
  // 装配要是被拒了，下面那句「行不在」会红得跟缺陷一模一样 —— 先把拒绝的原话读出来。
  await expect(page.getByTestId('connector-assemble-error')).toHaveCount(0);
  await expect(page.getByTestId('connector-assemble-useless')).toHaveCount(0);
  await page.getByTestId('connector-modal-close').click();

  // 没有品类 → 行的 testid 后面是空的。这本身也是同一个根（两条无品类的连接器会撞 testid）。
  const row = page.getByTestId('connector-row-');
  await expect(row).toBeVisible();
  await expect(
    row.getByTestId('connector-card-name'),
    'an uploaded connector with no category must still name its vendor',
  ).toHaveText('Acme Calendar');
}

// uploadedRowTakesCredentials —— 传一个连接器，然后在同一页上找给它填凭据的地方。
async function uploadedRowTakesCredentials(page: Page): Promise<void> {
  await uploadConnector(page, validCalendarSpec(), calendarBinding());

  const row = page.getByTestId('connector-row-calendar');
  await expect(row).toBeVisible();

  // 断的是内置卡真正渲染的那两样（`connector-field-*` + CONNECT）——
  // 第一版我断了 `connector-cred-form`，那个 testid 在另一个老组件里、**内置卡也没有**，
  // 于是修完照样红：红得不知所以然（[[read-the-failure-before-theorising]]）。
  // client_id 只可能来自后端按**这份 spec 声明的 oauth2 方案**派生的表单 ——
  // 断一个具体字段，一张空表单就过不了。
  await expect(
    row.getByTestId('connector-field-client_id'),
    'an uploaded connector must take credentials, not just be listed and deleted',
  ).toBeVisible();
  await expect(
    row.getByTestId('connector-connect-button'),
    'and there must be somewhere to press once they are filled in',
  ).toBeVisible();
}

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

// uploadConnector —— 打开 add → 填 spec+绑定 → **校验 → 装配** → 等列表里出现该品类行。
//
// 校验和装配现在是两个动作（F-C-21）：`connector-spec-submit` 只校验（出候选 + 派生凭据表单），
// `connector-assemble-button` 才建连接器。以前这两件事挤在同一个按钮上，而它做哪一件取决于
// binding 框空不空 —— 一个按钮两种语义，正是 owner 拿真 vendor spec 时走进死胡同的原因。
async function uploadConnector(
  page: Page, spec: string, binding: string,
): Promise<void> {
  await openConnectorAdd(page);
  await fillSpecAndBinding(page, spec, binding);
  await assembleFilledSpec(page);
  // 装配之后模态**留着**（表单让位给新连接器的卡：凭据 + Connect 在那儿）。这条用例只关心
  // 它有没有落进列表，所以自己关掉模态 —— 区内主体在模态开着时不渲染。
  await page.getByTestId('connector-modal-close').click();
  await expect(page.getByTestId('connector-row-calendar')).toBeVisible();
}

// assembleFilledSpec —— 表单已填好 → 校验 → 等候选出现 → 装配。**不关模态**：重名那条路上
// 模态会自己让位给覆盖确认（待回答的问题优先于模态），这里再去点关闭就会扑空。
async function assembleFilledSpec(page: Page): Promise<void> {
  await page.getByTestId('connector-spec-submit').click();
  await expect(page.getByTestId('connector-candidate')).toBeVisible();
  await page.getByTestId('connector-assemble-button').click();
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
