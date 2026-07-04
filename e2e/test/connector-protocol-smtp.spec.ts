// connector-protocol-smtp.spec.ts —— #155 §8 区 E（protocol SMTP）目标契约（RED）。
//
// 业务故事：owner 装一个 kind=protocol 的 SMTP 连接器填「mail」品类槽。区别于
// openapi 连接器（表单从 spec 的 securitySchemes 派生），SMTP 是**内置实现**——
// 凭据表单是**手定固定**的 6 个字段（host/port/username/password/from/tls，见
// docs/design/connector.md §2 smtpForm），不来自任何 spec。owner 选「SMTP
// (protocol)」→ 固定表单渲染 → 填 → 点 connect（无 OAuth dance，存密钥即连）→
// 后端真开 SMTP 连接做 connection test → Connected。
//
// 这是 TDD 红测：真编译、真跑、真红，红在「protocol 连接器 UI 装配 + 固定表单 +
// 连接测试」这条尚未建的路上（现状 mail connector 是手搓 gcal-style 形态、表单不是
// 从通用 protocol descriptor 渲的）。实现逐区转绿后去掉 test.fixme。
//
// 真服务：后端拨号 mail-mock 的 SMTP 端（1025）→ 转发 Mailpit。错误路径用 mail-mock
// 的 fault 控制面 + 故意填错 host/port/auth/tls 逼出连接失败。不碰真外部 SMTP。
//
// §8 接口草图对齐：
//   testid: connector-add-open / connector-card-smtp / connector-scheme-select
//           / connector-field-{key} / connector-connect-button
//           / connector-status(connected|not) / connector-config-save
//   REST  : POST /api/admin/connectors（从 protocol 内置建）
//           POST …/{id}/credentials / POST …/{id}/connect(=连接测试) / GET …/{id}/status

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// 后端在 compose 网内拨号 mail-mock 的 SMTP 端（1025）→ Mailpit。健康 SMTP 端点。
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mail-mock';
const SMTP_PORT = 1025;

const OWNER = {
  email: 'smtp-protocol@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'smtpowner',
  fullName: 'SMTP Owner',
};

// SMTP protocol 连接器的固定凭据字段（手定，docs §2 smtpForm）；任何「装个 SMTP」
// 都填这 6 个，不从 spec 派生。
const SMTP_FIELDS = {
  host: SMTP_HOST,
  port: String(SMTP_PORT),
  username: '',
  password: '',
  from: 'noreply@standmeet.test',
  tls: 'none', // mail-mock 1025 明文
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector · protocol SMTP (kind=protocol, fixed credential form)', () => {
  // 红契约：protocol(SMTP) 连接器 UI 装配 + 固定表单 + 连接测试未建（connector.md §8 区 E）。实现后删。

  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // —— happy：固定表单渲染（NOT derived from a spec）→ 填 → 连接测试 → Connected ——
  test('pick SMTP(protocol) → 6 fixed fields render (not spec-derived) → fill → connect → Connected',
    async ({ adminPage }) => {
      await openSMTPForm(adminPage);
      await assertFixedFormNotDerived(adminPage);

      await fillSMTPForm(adminPage, SMTP_FIELDS);
      await adminPage.getByTestId('connector-config-save').click();

      // protocol 无 OAuth dance：点 connect = 做一次真 SMTP 连接测试。
      await adminPage.getByTestId('connector-connect-button').click();
      await expect(adminPage.getByTestId('connector-status')).toHaveText(/connected|已连接/i);
    });

  // —— err：坏 host/port → 连接测试失败，UI 友好报错，不 Connected ——
  test('wrong host/port → connection test fails → friendly error, status stays not connected',
    async ({ adminPage }) => {
      await openSMTPForm(adminPage);
      await fillSMTPForm(adminPage, {
        ...SMTP_FIELDS, host: 'no-such-smtp-host.invalid', port: '2525',
      });
      await adminPage.getByTestId('connector-config-save').click();
      await adminPage.getByTestId('connector-connect-button').click();

      // 连接失败：可见友好错误，状态不翻 connected，无原始 stack/技术黑话。
      const err = adminPage.getByTestId('connector-error');
      await expect(err).toBeVisible();
      await expect(err).toHaveText(/couldn'?t connect|connection|unreachable|无法连接|连接失败/i);
      await expect(err).not.toHaveText(/panic|goroutine|stack|ECONNREFUSED|dial tcp/i);
      await expect(adminPage.getByTestId('connector-status')).not.toHaveText(/connected|已连接/i);
    });

  // —— err：坏 SMTP 认证配置 → 连接测试失败 → 不连接 ——（API 层断言，避开 UI flake）
  // 注:mail-mock 是明文、不 advertise STARTTLS/AUTH,且后端用 net/smtp PlainAuth(明文非
  // localhost 连接上拒发凭据)。所以这里验的是真实通用行为——**带凭据的 SMTP 在无法完成
  // auth/TLS 握手时,连接测试按 auth/tls 类别友好失败、状态保持未连接、不泄露原始协议码/栈**。
  // (不伪造 mock 侧 535:那条路径经 PlainAuth 明文限制根本不可达。)
  test('bad SMTP auth config (handshake cannot complete) → connection test fails → not connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const id = await createSMTPConnector(request);
      await postCredentials(request, id, {
        ...SMTP_FIELDS, username: 'wrong-user', password: 'wrong-pass', tls: 'starttls',
      });
      const { status, body } = await postConnect(request, id);

      expect(status, 'an auth/tls failure must not be a server crash').toBeLessThan(500);
      expect(body.connected, 'handshake cannot complete → not connected').toBe(false);
      expect(`${body.error ?? ''}`, 'friendly auth/tls error')
        .toMatch(/auth|credential|password|tls|handshake|认证|凭据/i);
      expect(`${body.error ?? ''}`, 'does not leak the raw protocol code/stack').not.toMatch(/panic|goroutine|stack/i);

      const st = await getStatus(request, id);
      expect(st.connected).toBe(false);
      await request.dispose();
    });

  // —— err：TLS 不符（端点明文却要求 tls）→ 握手失败 → 连接测试失败 ——
  test('TLS mismatch (implicit tls required on a plaintext endpoint) → handshake fails → status not connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const id = await createSMTPConnector(request);
      // 健康明文端点（1025）却选 implicit tls → TLS 握手失败。
      await postCredentials(request, id, { ...SMTP_FIELDS, tls: 'tls' });
      const { status, body } = await postConnect(request, id);

      expect(status, 'a TLS handshake failure must not be a 5xx').toBeLessThan(500);
      expect(body.connected, 'TLS mismatch → not connected').toBe(false);
      expect(`${body.error ?? ''}`, 'friendly TLS error').toMatch(/tls|encrypt|handshake|secure|加密|握手/i);
      expect(`${body.error ?? ''}`).not.toMatch(/panic|goroutine|stack/i);

      const st = await getStatus(request, id);
      expect(st.connected).toBe(false);
      await request.dispose();
    });
});

// ─── helpers (inline; promote to fixtures/connector-protocol.ts when实现转绿) ───

interface ConnectResp { connected: boolean; error?: string }
interface StatusResp { connected: boolean; category?: string; kind?: string }

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await login(request, OWNER.email, OWNER.password);
  await request.dispose();
}

async function openConnectors(page: Page): Promise<void> {
  await gotoAdminSection(page, 'connectors');
  await page.waitForURL('**/admin/connectors');
}

// openSMTPForm —— 进 connectors → 开 add 模态 → 点 SMTP(protocol) 卡片 → 渲固定表单。
async function openSMTPForm(page: Page): Promise<void> {
  await openConnectors(page);
  await page.getByTestId('connector-add-open').click();
  // protocol 连接器在 catalog 里是「SMTP」卡片；点开 → 渲固定表单。
  await page.getByTestId('connector-card-smtp').click();
}

// assertFixedFormNotDerived —— protocol 连接器**没有 spec 输入 / 没有 scheme 选择器**：
// 表单手定固定，不从 securitySchemes 派生（这是区分 openapi 路的命门）。
async function assertFixedFormNotDerived(page: Page): Promise<void> {
  await expect(page.getByTestId('connector-spec-input')).toHaveCount(0);
  await expect(page.getByTestId('connector-scheme-select')).toHaveCount(0);
  for (const key of Object.keys(SMTP_FIELDS)) {
    await expect(page.getByTestId(`connector-field-${key}`)).toBeVisible();
  }
  // password 是 secret（type=password），tls 是 select。
  await expect(page.getByTestId('connector-field-password')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('connector-field-tls')).toHaveJSProperty('tagName', 'SELECT');
}

async function fillSMTPForm(page: Page, fields: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(fields)) {
    const field = page.getByTestId(`connector-field-${key}`);
    if (key === 'tls') { await field.selectOption(value); continue; }
    await field.fill(value);
  }
}

// createSMTPConnector —— POST /api/admin/connectors 从内置 protocol(SMTP) 建一行，
// 返回 connector id（§8 把 gcal 那套泛化到 {id}）。kind=protocol 不带 spec。
async function createSMTPConnector(request: APIRequestContext): Promise<string> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
    data: { kind: 'protocol', protocol: 'smtp', category: 'mail' },
  });
  if (res.status() !== 201) throw new Error(`create smtp connector: ${res.status()}`);
  return (await res.json() as { id: string }).id;
}

async function postCredentials(
  request: APIRequestContext, id: string, fields: Record<string, string>,
): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: fields,
  });
  if (res.status() !== 200) throw new Error(`smtp credentials: ${res.status()}`);
}

async function postConnect(
  request: APIRequestContext, id: string,
): Promise<{ status: number; body: ConnectResp }> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  return { status: res.status(), body: await res.json() as ConnectResp };
}

async function getStatus(request: APIRequestContext, id: string): Promise<StatusResp> {
  const res = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  if (res.status() !== 200) throw new Error(`smtp status: ${res.status()}`);
  return await res.json() as StatusResp;
}
