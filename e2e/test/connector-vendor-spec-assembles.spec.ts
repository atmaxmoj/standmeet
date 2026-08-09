// connector-vendor-spec-assembles.spec.ts —— connector-assembly checks 2 + 3,走 owner 真会走的那条路。
//
// 真厂商文档(Cal.com v2)的形状是:**显式 `servers: []`,`components.securitySchemes` 也空**。
// 手工驱这个模块时,面板对这两件事的表现是分裂的:
//
//   认证那一半做对了 —— "this spec declares no authentication — if the API needs a key, pick one
//   below" + 三个 manual 方案 + token 框,owner 当场补得上;
//   base URL 那一半只说了缺什么,**面上没有一处能补**(F-C-22)。owner 唯一的出路是手改 vendor 的
//   文件 —— 而 item 的原话正是「An owner must not have to hand-edit a vendor's file to use it」。
//
// 而且收齐了一切之后**没有提交**(F-C-21):候选、方案、token 都在屏幕上,却没有一个按钮能把它们变成
// 一个连接器。能提交的是另一处形状不同的表单,走过去这些还全没了。
//
// 两条断言都断**产物**,不断"点得动":
//   ① 补上 base URL 之后**候选真的出现**(不是"错误消失了"——空错误 ≠ 解析成功);
//   ② 点装配之后 `GET /api/admin/connectors` **真的多出一行**(按钮自己的反馈不算证据)。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// BASE_URL —— owner 手填的 base URL。用一个**跟 spec 里任何字样都不重合**的主机名,这样
// "它真的被用上了"在后面查连接器时是可分辨的,而不是碰巧撞上。
const BASE_URL = 'https://api.vendor-supplied.test/v2';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a real vendor spec (no servers, no auth) assembles into a connector', () => {
  test.beforeAll(async ({ playwright }) => {
    // resetInstance 在负载高的机器上实测要 ~48s(truncate 30 张表 22s + unclaim 14s),而钩子
    // 默认只给 30s。一条用例失败后 Playwright 会换 worker,于是这个钩子**会再跑一遍** ——
    // 第二条用例就死在这里,看起来像它自己的问题。给足时间,别让环境的慢冒充产品的红。
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // F-C-22 —— 说得出缺什么,就得有一处能补。
  test('the missing base URL has a place to be supplied, and the candidate then appears',
    async ({ adminPage: page }) => {
      await openConnectorAdd(page);
      await page.getByTestId('connector-spec-input').fill(vendorSpecNoServers());
      await page.getByTestId('connector-spec-submit').click();

      // 先证拒绝确实发生了 —— 否则下面"补上就好了"可能只是它本来就不需要补。
      const err = page.getByTestId('connector-spec-error');
      await expect(err).toContainText(/servers|base url/i);

      await page.getByTestId('connector-spec-base-url').fill(BASE_URL);
      await page.getByTestId('connector-spec-submit').click();

      // 断候选**出现**,而不是断错误消失:后者在请求挂掉时也成立。
      await expect(page.getByTestId('connector-candidate')).toContainText(/vendor scheduling/i);
      await expect(err).toHaveCount(0);
    });

  // F-C-21 —— 收齐了一切的那个表单必须能提交,而且提交出来的东西在别处看得见。
  //
  // 这一条**刻意用一份自带 servers 的 spec**:否则它会先死在 F-C-22 那个缺失的输入框上,
  // 于是两个守卫证的是同一件事,而其中一个坏了另一个会替它挡住。分开之后,这条只问一件事 ——
  // **没有任何东西要补的时候,收齐了的表单能不能提交。**
  test('the form that collected spec and scheme can actually assemble a connector',
    async ({ adminPage: page }) => {
      const before = await connectorIDs(page);

      await openConnectorAdd(page);
      await page.getByTestId('connector-spec-input').fill(vendorSpecWithServers());
      await page.getByTestId('connector-spec-submit').click();
      await expect(page.getByTestId('connector-candidate')).toBeVisible();

      // spec 没声明认证 → 面板给三个 manual 方案。选 bearer(真厂商 key 就是这么用的)。
      await page.getByTestId('connector-scheme-select').selectOption('manual:bearer');

      // 先证**不勾就装不出来**:没有 binding(不占品类槽)又没开给访客 AI,建出来谁都调不到。
      // 少了这一半,下面那个绿只说明「点得动」,不说明「装出来的东西有人能用」。
      await page.getByTestId('connector-assemble-button').click();
      await expect(page.getByTestId('connector-assemble-useless')).toBeVisible();

      // 勾上「开给访客的 AI」—— 这是 owner 的明确授权,不是从 binding 空不空推出来的。
      await page.getByTestId('connector-expose-agent-tools').check();
      await page.getByTestId('connector-assemble-button').click();

      // 证据在连接器列表里,不在按钮上。
      const created = await newConnectorID(page, before);
      expect(created, 'assembling must leave a connector behind').not.toBe('');
    });
});

// ── helpers ────────────────────────────────────────────────────────────────

async function openConnectorAdd(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  await page.getByTestId('connector-add-open').click();
  await expect(page.getByTestId('connector-spec-input')).toBeVisible();
}

interface ConnRow { id: string; kind: string }

async function connectorIDs(page: Page): Promise<Set<string>> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) throw new Error(`list connectors: ${res.status()}`);
  const rows = (await res.json() as { connectors?: ConnRow[] }).connectors ?? [];
  return new Set(rows.map((c) => c.id));
}

// newConnectorID —— 轮询直到出现一个 before 快照里没有的 openapi 连接器。按「新增的 id」认,
// 不按「列表非空」——后者在实例里本来就有内置连接器时永远为真。
async function newConnectorID(page: Page, before: Set<string>): Promise<string> {
  let found = '';
  await expect.poll(async () => {
    const res = await page.request.get(`${BACKEND}/api/admin/connectors`);
    if (res.status() !== 200) return false;
    const rows = (await res.json() as { connectors?: ConnRow[] }).connectors ?? [];
    found = rows.find((c) => !before.has(c.id) && c.kind === 'openapi')?.id ?? '';
    return found !== '';
  }, { timeout: 15_000 }).toBe(true);
  return found;
}

// vendorSpecNoServers —— 真厂商文档的那两个特征:**显式空 `servers`**(不是缺字段)+ 无
// securitySchemes。Cal.com v2 的 openapi.json 就是这个形状(第 698931 字节处写着 "servers": [])。
function vendorSpecNoServers(): string {
  return vendorSpec([]);
}

// vendorSpecWithServers —— 同一份文档,但 base URL 已经在里面。给 F-C-21 那条用:它要问的是
// 「没有东西要补时能不能提交」,不该被 base URL 那个洞牵连。
function vendorSpecWithServers(): string {
  return vendorSpec([{ url: BASE_URL }]);
}

function vendorSpec(servers: { url: string }[]): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Vendor Scheduling API', version: '2.0.0' },
    servers,
    paths: {
      '/bookings': {
        get: {
          operationId: 'bookings.list',
          summary: 'List bookings',
          responses: { '200': { description: 'ok' } },
        },
        post: {
          operationId: 'bookings.create',
          summary: 'Create a booking',
          responses: { '201': { description: 'created' } },
        },
      },
    },
  });
}
