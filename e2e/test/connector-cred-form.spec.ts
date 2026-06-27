// connector-cred-form.spec.ts —— #155 区 B（凭据表单派生）RED 契约。
//
// 业务故事：owner 在 /admin/connectors 贴一份 OpenAPI 3.0 spec → 后端读
// `components.securitySchemes` → 派生一个 CredentialForm descriptor →
// 前端通用渲染器据 AuthType 渲对应字段（不每个连接器手写表单）。本区只钉
// 「表单怎么从 spec 派生 + 渲对」，连接动作（OAuth dance / 存密钥）归 D 区。
//
// 对齐 docs/design/connector.md §4（认证 type → 字段表）+ §7 决策#3（多
// scheme owner UI 自选）+ §8 区 B testid（connector-spec-input /
// connector-scheme-select / connector-field-{key} / connector-connect-button
// / connector-status）。
//
// 全 test.fixme：spec-driven 凭据表单 UI 未建，红在「即将要做的」派生器上。
// 实现逐条转绿后去掉 fixme。

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

// ──────────────────────────────────────────────────────────────────────────
// Sample OpenAPI 3.0 specs — inlined per-scheme. Each carries exactly the
// securityScheme(s) the test exercises so the derived form is unambiguous.
// (Promote these to a shared fixture once a second spec-file needs them.)
// ──────────────────────────────────────────────────────────────────────────

// oauth2 (authorizationCode) — owner fills client_id + client_secret; token is
// NOT a field (Connect runs the dance); scope is a multi-select; per-connector
// redirect_uri is shown read-only for owner to register.
const SPEC_OAUTH2 = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Calendar OAuth2 API', version: '1.0.0' },
  servers: [{ url: 'https://api.cal.example.com/v1' }],
  paths: {
    '/freebusy': {
      get: { operationId: 'freebusy.query', security: [{ oauth2: ['cal.read'] }], responses: { '200': { description: 'ok' } } },
    },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://api.cal.example.com/oauth/authorize',
            tokenUrl: 'https://api.cal.example.com/oauth/token',
            scopes: { 'cal.read': 'Read calendar', 'cal.write': 'Write calendar' },
          },
        },
      },
    },
  },
});

// apiKey — single key field; UI shows where it goes (header/query + name).
const SPEC_APIKEY = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Mail ApiKey API', version: '1.0.0' },
  servers: [{ url: 'https://api.mail.example.com' }],
  paths: { '/send': { post: { operationId: 'mail.send', security: [{ apiKey: [] }], responses: { '202': { description: 'queued' } } } } },
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
  },
});

// http basic — username + password fields.
const SPEC_HTTP_BASIC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Basic API', version: '1.0.0' },
  servers: [{ url: 'https://api.basic.example.com' }],
  paths: { '/ping': { get: { operationId: 'ping', security: [{ basic: [] }], responses: { '200': { description: 'ok' } } } } },
  components: { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } },
});

// http bearer — single token field.
const SPEC_HTTP_BEARER = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Bearer API', version: '1.0.0' },
  servers: [{ url: 'https://api.bearer.example.com' }],
  paths: { '/ping': { get: { operationId: 'ping', security: [{ bearer: [] }], responses: { '200': { description: 'ok' } } } } },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
});

// multiple schemes (oauth2 OR apiKey) — UI shows a scheme picker; choosing one
// renders that scheme's fields (form is dynamic to the choice; §7 决策#3).
const SPEC_MULTI = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Multi-auth API', version: '1.0.0' },
  servers: [{ url: 'https://api.multi.example.com' }],
  paths: {
    '/data': {
      get: {
        operationId: 'data.get',
        security: [{ oauth2: ['data.read'] }, { apiKey: [] }],
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
            authorizationUrl: 'https://api.multi.example.com/oauth/authorize',
            tokenUrl: 'https://api.multi.example.com/oauth/token',
            scopes: { 'data.read': 'Read data' },
          },
        },
      },
      apiKey: { type: 'apiKey', in: 'query', name: 'api_key' },
    },
  },
});

// no securityScheme — derive should surface a friendly "no supported auth".
const SPEC_NO_AUTH = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'No-auth API', version: '1.0.0' },
  servers: [{ url: 'https://api.noauth.example.com' }],
  paths: { '/open': { get: { operationId: 'open.get', responses: { '200': { description: 'ok' } } } } },
});

// unsupported auth type (mutualTLS) — derive should reject/flag it.
const SPEC_UNSUPPORTED = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'mTLS API', version: '1.0.0' },
  servers: [{ url: 'https://api.mtls.example.com' }],
  paths: { '/x': { get: { operationId: 'x.get', security: [{ mtls: [] }], responses: { '200': { description: 'ok' } } } } },
  components: { securitySchemes: { mtls: { type: 'mutualTLS' } } },
});

// ──────────────────────────────────────────────────────────────────────────

// claimOwner —— shared beforeAll body (split across two describe blocks so each
// describe callback stays under the 70-line cap).
async function claimOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

test.describe('connector · 凭据表单从 spec 派生 · happy（区 B）', () => {
  // 红契约：spec-driven 凭据表单派生未建（docs/design/connector.md §4/§8 区 B）。
  test.fixme(true, 'pending #155: spec-driven credential form derivation');

  test.beforeAll(async ({ playwright }) => { await claimOwner(playwright); });

  // ── happy: oauth2 ────────────────────────────────────────────────────────
  test('oauth2 spec → client_id + client_secret + scope picker + readonly redirect_uri + Connect',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_OAUTH2);

      // owner fills the app's OAuth client creds; token is NOT a field.
      await expect(page.getByTestId('connector-field-client_id')).toBeVisible();
      await expect(page.getByTestId('connector-field-client_secret')).toBeVisible();
      await expect(page.getByTestId('connector-field-token')).toHaveCount(0);

      // scope is a multi-select drawn from the flow's scopes.
      const scope = page.getByTestId('connector-field-scope');
      await expect(scope).toBeVisible();
      await expect(scope).toContainText(/cal\.read/);
      await expect(scope).toContainText(/cal\.write/);

      // per-connector redirect_uri shown read-only (owner registers it upstream).
      const redirect = page.getByTestId('connector-field-redirect_uri');
      await expect(redirect).toBeVisible();
      await expect(redirect).toHaveAttribute('readonly', '');

      // oauth2 needs the dance → a Connect button is present.
      await expect(page.getByTestId('connector-connect-button')).toBeVisible();
    });

  // ── happy: apiKey ────────────────────────────────────────────────────────
  test('apiKey spec → single key field + shows where it goes (header + name)',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_APIKEY);

      const key = page.getByTestId('connector-field-key');
      await expect(key).toBeVisible();
      // no oauth client creds for a bare apiKey scheme.
      await expect(page.getByTestId('connector-field-client_id')).toHaveCount(0);

      // UI tells owner where the key is injected: header X-Api-Key.
      const form = page.getByTestId('connector-cred-form');
      await expect(form).toContainText(/header/i);
      await expect(form).toContainText(/X-Api-Key/);

      // no dance → no Connect button (just save the key).
      await expect(page.getByTestId('connector-connect-button')).toHaveCount(0);
    });

  // ── happy: http basic ────────────────────────────────────────────────────
  test('http basic spec → username + password fields', async ({ adminPage: page }) => {
    await pasteSpec(page, SPEC_HTTP_BASIC);

    await expect(page.getByTestId('connector-field-username')).toBeVisible();
    const pass = page.getByTestId('connector-field-password');
    await expect(pass).toBeVisible();
    await expect(pass).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('connector-field-token')).toHaveCount(0);
  });

  // ── happy: http bearer ───────────────────────────────────────────────────
  test('http bearer spec → single token field', async ({ adminPage: page }) => {
    await pasteSpec(page, SPEC_HTTP_BEARER);

    const token = page.getByTestId('connector-field-token');
    await expect(token).toBeVisible();
    await expect(token).toHaveAttribute('type', 'password');
    // bearer ≠ basic: no username/password split.
    await expect(page.getByTestId('connector-field-username')).toHaveCount(0);
    await expect(page.getByTestId('connector-field-password')).toHaveCount(0);
  });

  // ── happy: multiple schemes → dynamic picker ─────────────────────────────
  test('multi-scheme spec → scheme picker; picking each renders that scheme fields',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_MULTI);

      // §7 决策#3: a scheme selector appears when >1 scheme is available.
      const select = page.getByTestId('connector-scheme-select');
      await expect(select).toBeVisible();

      // pick oauth2 → oauth fields render, no apiKey field.
      await select.selectOption('oauth2');
      await expect(page.getByTestId('connector-field-client_id')).toBeVisible();
      await expect(page.getByTestId('connector-field-client_secret')).toBeVisible();
      await expect(page.getByTestId('connector-connect-button')).toBeVisible();
      await expect(page.getByTestId('connector-field-key')).toHaveCount(0);

      // pick apiKey → the form swaps to the key field, oauth fields gone.
      await select.selectOption('apiKey');
      await expect(page.getByTestId('connector-field-key')).toBeVisible();
      await expect(page.getByTestId('connector-field-client_id')).toHaveCount(0);
      await expect(page.getByTestId('connector-connect-button')).toHaveCount(0);
      // apiKey here is in query param api_key — surfaced to owner.
      await expect(page.getByTestId('connector-cred-form')).toContainText(/query/i);
      await expect(page.getByTestId('connector-cred-form')).toContainText(/api_key/);
    });
});

test.describe('connector · 凭据表单从 spec 派生 · err（区 B）', () => {
  test.fixme(true, 'pending #155: spec-driven credential form derivation');

  test.beforeAll(async ({ playwright }) => { await claimOwner(playwright); });

  // ── err: no supported auth ───────────────────────────────────────────────
  test('spec with no securityScheme → friendly "no supported auth" message',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_NO_AUTH);

      const status = page.getByTestId('connector-status');
      await expect(status).toContainText(/no supported auth|不支持的认证|无可用认证/i);
      // no fields, no Connect — nothing to fill.
      await expect(page.getByTestId('connector-field-client_id')).toHaveCount(0);
      await expect(page.getByTestId('connector-field-key')).toHaveCount(0);
      await expect(page.getByTestId('connector-connect-button')).toHaveCount(0);
    });

  // ── err: unsupported auth type ───────────────────────────────────────────
  test('spec with unsupported auth type (mutualTLS) → rejected/flagged',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_UNSUPPORTED);

      const status = page.getByTestId('connector-status');
      await expect(status).toContainText(/unsupported|not supported|不支持|mutualTLS/i);
      // unsupported scheme must not be rendered as a usable field.
      await expect(page.getByTestId('connector-field-token')).toHaveCount(0);
      await expect(page.getByTestId('connector-connect-button')).toHaveCount(0);
    });
});

// pasteSpec —— navigate to the connectors area by clicking (no page.goto),
// open the spec input, paste a spec, and trigger derivation. The derived
// credential form / status is what each test asserts against.
async function pasteSpec(page: Page, spec: string): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.getByTestId('connector-spec-input').fill(spec);
  // derivation is triggered by leaving the field; assertions then poll the form.
  await page.getByTestId('connector-spec-input').blur();
}
