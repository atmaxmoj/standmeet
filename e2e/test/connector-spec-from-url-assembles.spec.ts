// connector-spec-from-url-assembles.spec.ts —— F-C-25 + F-C-26。
//
// 两条都是在 prod 上用 Cal.com 自己发布的真文档驱出来的,而它们能活到今天是因为**「从 URL 抓
// spec」这条路的 happy path 一条 e2e 都没有**:用到抓取的两条现有用例走的都是失败场景
// (不可达 / 被出站策略挡),于是「抓回来的那份文档能不能真的装配成连接器」从来没人走过。
//
// F-C-25 —— 抓得到候选,装配却送出一份**空 spec**(正文只存在于后端那次抓取里)。
// F-C-26 —— 装配失败时模态里**一个字都没有**,表单原样待着,像那一下点击没发生过。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// SPEC_URL / BASE_URL —— 都指 external-mock:后端(不是浏览器)去抓,所以要用容器内可达的地址;
// 它也在 CONNECTOR_EGRESS_ALLOW 里,装配期的出站静态校验才放行。
const SPEC_URL = 'http://external-mock:9000/vendor-openapi/no-servers.json';
const BASE_URL = 'http://external-mock:9000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a spec fetched from a URL can actually be assembled', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s,而钩子默认只给 30s
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // F-C-25 —— 整段真实旅程:抓 → 被拒并点名 → 补 base URL → 出候选 → 装配 → 列表里真多一行。
  test('fetch by URL → supply the base URL → assemble leaves a connector behind',
    async ({ adminPage: page }) => {
      const before = await connectorIDs(page);
      await openConnectorAdd(page);

      await page.getByTestId('connector-spec-url-input').fill(SPEC_URL);
      await page.getByTestId('connector-spec-fetch-button').click();
      // 先证拒绝确实发生了 —— 否则下面「补上就好了」可能只是它本来就不需要补。
      await expect(page.getByTestId('connector-spec-error')).toContainText(/servers|base url/i);

      await page.getByTestId('connector-spec-base-url').fill(BASE_URL);
      await page.getByTestId('connector-spec-fetch-button').click();
      await expect(page.getByTestId('connector-candidate')).toContainText(/vendor scheduling/i);

      await page.getByTestId('connector-scheme-select').selectOption('manual:bearer');
      await page.getByTestId('connector-field-token').fill('vendor-test-token');
      // 无 binding → 必须由 owner 明确开放给访客 AI,否则装出来谁都调不到(见 isAssemblable)。
      await page.getByTestId('connector-expose-agent-tools').check();
      await page.getByTestId('connector-assemble-button').click();

      // 证据在连接器列表里,不在按钮上。
      expect(await newConnectorID(page, before), 'a URL-fetched spec must assemble')
        .not.toBe('');
    });

  // F-C-26 —— 装配失败必须**在模态里**说出来。用一个品类不存在的 binding 制造一次真实的后端
  // 拒绝:spec 本身合法(校验能过、候选会出),但建连接器时品类落不到任何契约上。
  test('a refused assemble says so inside the modal', async ({ adminPage: page }) => {
    await openConnectorAdd(page);

    await page.getByTestId('connector-spec-input').fill(specWithServers());
    await page.getByTestId('connector-binding-input').fill(bindingUnknownCategory());
    await page.getByTestId('connector-spec-submit').click();
    await expect(page.getByTestId('connector-candidate')).toBeVisible();

    await page.getByTestId('connector-assemble-button').click();

    // 断**模态里看得见的那句话**。页面级 toast 不算:模态盖着整页,owner 看不到它。
    const err = page.getByTestId('connector-assemble-error');
    await expect(err).toBeVisible();
    const shown = await err.innerText();
    expect(shown.trim().length, 'the refusal must actually say something').toBeGreaterThan(0);
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

// specWithServers —— 合法且自带 base URL:这一条要问的是「失败说不说得出来」,不该被 base URL
// 那件事牵连。
function specWithServers(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Refusable API', version: '1.0.0' },
    servers: [{ url: BASE_URL }],
    paths: {
      '/v2/bookings': {
        get: { operationId: 'bookings.list', responses: { '200': { description: 'ok' } } },
      },
    },
  });
}

// bindingUnknownCategory —— 品类是个不存在的契约名 → 装配期落不到任何适配器上,后端拒。
function bindingUnknownCategory(): string {
  return [
    'category: telepathy',
    'operations:',
    '  list_slots:',
    '    op: bookings.list',
    '    response: "$"',
    '',
  ].join('\n');
}
