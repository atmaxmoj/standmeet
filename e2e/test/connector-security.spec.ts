// connector-security.spec.ts —— #155 §8 区 H（安全 · RED 契约）。
//
// 「owner 上传任意 OpenAPI spec」把三道安全门逼出来；这三道在 spec-driven
// connector 实现里必须成立，本文件给它们立靶子（全 test.fixme，红到实现为止）：
//
//   1. ⚠️ SSRF —— 上传的 spec 里 `servers[].url`（以及 oauth2 的 token/authorize
//      URL）若指向 loopback / link-local / 私网，后端 **拒装配或拒发起出站请求**。
//      owner 不该能借「自托管、无中心审核」的上传通道把实例当 SSRF 跳板打内网
//      （cloud metadata 169.254.169.254 / localhost / 10.x / 127.x）。
//   2. 凭据永不外泄 —— 一个 user-uploaded openapi connector 连上后，存的
//      client_secret / api key 经 list / status / 任意 admin 读路径返回时**打码**，
//      原文绝不出现；也绝不出现在任何访客可见产物里。扩 handle_contract_test.go +
//      connector-secret-no-leak.spec.ts 的精神到「上传的」连接器。
//   3. per-owner 隔离 —— 上传的 connector + 其 connection 归一个 owner。v1 单 owner，
//      所以在 API 层钉 owner_id scoping：未鉴权 / 跨 session 拿不到、用不了。
//
// 对齐 §8 接口草图：
//   POST   /api/admin/connectors            （从 spec 建）
//   POST   /api/admin/connectors/{id}/credentials
//   POST   /api/admin/connectors/{id}/connect      （起 oauth）
//   GET    /api/admin/connectors/{id}/status
//   GET    /api/admin/connectors                    （list）
//   DELETE /api/admin/connectors/{id}/disconnect
//
// 现状 connectors 是手搓 gcal-specific + 18-entry 静态 catalog；「从 spec POST 建
// 任意 connector」这套未建，所以本测真编译、真跑、真红，红在即将要做的上传路径上。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'sec-connector@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'secconn',
  fullName: 'Security Connector Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ── inlined sample/malicious specs (promote to fixtures when impl lands) ──────
//
// minimal-but-valid OpenAPI 3.0 base; tests clone it and swap `servers[].url`
// (or the oauth2 token/authorize URLs) to the internal address under test.
// Everything else is benign so a REJECT can only be attributed to the URL.

const INTERNAL_SERVER_URLS = [
  'http://localhost:8000',          // the backend itself (loopback)
  'http://127.0.0.1/admin',         // loopback IP
  'http://169.254.169.254/latest/meta-data/', // cloud metadata (the classic SSRF target)
  'http://10.0.0.5/internal',       // RFC1918 private
  'http://192.168.1.1/router',      // RFC1918 private
  'http://[::1]:8000/v1',           // IPv6 loopback
  'http://metadata.google.internal/computeMetadata/v1/', // GCP metadata hostname
];

// SPEC_SSRF_SERVER —— a spec whose only "reach-out" surface is servers[].url.
// The apiKey scheme means assembly itself need not call out, but a freebusy-style
// consume would; the backend must refuse the internal base at validate or call time.
function specWithServerURL(url: string): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'SSRF probe', version: '1.0.0' },
    servers: [{ url }],
    paths: {
      '/freebusy': {
        get: {
          operationId: 'freebusy.query',
          security: [{ apiKeyAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
    },
  });
}

// SPEC_SSRF_OAUTH_URLS —— a benign servers[] but malicious oauth2 token/authorize
// URLs. The OAuth dance fetches those server-side, so internal URLs there are the
// SSRF vector even when the API base looks fine.
function specWithOAuthURLs(authorizeURL: string, tokenURL: string): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'OAuth SSRF probe', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/freebusy': {
        get: {
          operationId: 'freebusy.query',
          security: [{ oauth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: authorizeURL,
              tokenUrl: tokenURL,
              scopes: { read: 'read' },
            },
          },
        },
      },
    },
  });
}

// MOCK base — the programmable OAuth/HTTP mock. Consume-time SSRF specs point
// their public-looking base at a mock endpoint that 302-redirects to an internal
// address only WHEN CALLED, so they sail through any upload/connect-time static
// URL check and only reveal the internal hop at consume time.
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

// specConsumeRedirectsInternal —— servers[].url is a benign mock endpoint that,
// at call time, 302s to an internal address (the SSRF lands during the API call,
// not at validate time). apiKey scheme so upload+credentials succeed cleanly.
function specConsumeRedirectsInternal(): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Consume-time SSRF probe', version: '1.0.0' },
    // public-looking base; the mock 302s /freebusy → http://169.254.169.254/... at runtime.
    servers: [{ url: `${MOCK}/__mock/ssrf/redirect-internal` }],
    paths: {
      '/freebusy': {
        get: {
          operationId: 'freebusy.query',
          security: [{ apiKeyAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
    },
    'x-standmeet-category': 'calendar',
  });
}

// specOAuthDanceRedirectsInternal —— authorize/token URLs are benign mock
// endpoints that, at dance time, redirect the callback / token exchange toward an
// internal address. Passes any static upload-time URL check; the internal hop only
// appears once the server-side dance follows the provider's redirect.
function specOAuthDanceRedirectsInternal(): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'OAuth redirect SSRF probe', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/freebusy': {
        get: {
          operationId: 'freebusy.query',
          security: [{ oauth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              // mock authorize 302s the callback toward an internal host; the
              // token endpoint likewise redirects the server-side exchange inward.
              authorizationUrl: `${MOCK}/__mock/oauth/authorize?redirect=internal`,
              tokenUrl: `${MOCK}/__mock/oauth/token?redirect=internal`,
              scopes: { read: 'read' },
            },
          },
        },
      },
    },
  });
}

// SPEC_BENIGN_APIKEY —— a fully valid public-base apiKey connector, used by the
// credential-leak + isolation tests (must assemble cleanly so we can store a
// secret and then prove it never echoes / never crosses owner scope).
const BENIGN_API_KEY_SECRET = 'sk_live_uploaded_connector_secret_DO_NOT_LEAK_42';
const SPEC_BENIGN_APIKEY = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Benign calendar', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/freebusy': {
      get: {
        operationId: 'freebusy.query',
        security: [{ apiKeyAuth: [] }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
  },
  // a hint so the assembled connector lands in the calendar category slot
  'x-standmeet-category': 'calendar',
});

// uploadSpec —— POST /api/admin/connectors from a raw spec string. Returns the
// new connector id (assigned by the backend). Throws on non-2xx so callers that
// expect success fail loudly; SSRF tests call the endpoint directly to inspect
// the rejecting status instead.
async function uploadSpec(
  request: APIRequestContext, csrf: string, spec: string,
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
    data: { spec },
  });
  if (res.status() < 200 || res.status() >= 300) {
    throw new Error(`uploadSpec failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json() as { id?: string };
  if (!body.id) throw new Error('uploadSpec: response missing connector id');
  return body.id;
}

test.describe('connector · §8 区 H 安全 (SSRF / 凭据不外泄 / per-owner 隔离)', () => {
  // 红契约：spec-driven connector 上传 + 其安全门未建（docs/design/connector.md §8 H）。
  test.fixme(true, 'pending #155: user-uploaded connector security surface');

  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // ── 1. SSRF ──
  test('SSRF · servers[].url 指向 loopback/link-local/私网 → 拒装配或拒出站',
    ({ playwright }) => ssrfServerUrlRejected(playwright));

  test('SSRF · oauth2 authorize/token URL 指向内网 → connect 拒发起出站',
    ({ playwright }) => ssrfOAuthUrlRejected(playwright));

  test('SSRF · 拒后实例无残留连接器（list 不收录被拒的 spec）',
    ({ playwright }) => ssrfRejectLeavesNoConnector(playwright));

  // ── 2. 凭据永不外泄（扩 handle_contract / secret-no-leak 到 user-uploaded） ──
  test('凭据不外泄 · 上传 connector 存的 api key 在 status/list 里打码，原文不返回',
    ({ playwright }) => secretMaskedInAdminReads(playwright));

  test('凭据不外泄 · 上传 connector 的 secret 不出现在任何访客可见表面',
    ({ playwright }) => secretNotInVisitorSurface(playwright));

  // ── 1b. consume-time SSRF（upload/connect 过了，运行时调用才打内网） ──
  test('SSRF · 运行时 API 调用解析/重定向到内网 → runtime 拒绝出站',
    ({ playwright }) => ssrfConsumeTimeRejected(playwright));

  test('SSRF · OAuth dance 中 provider 把 callback/token 交换重定向到内网 → 拒绝',
    ({ playwright }) => ssrfOAuthDanceRedirectRejected(playwright));

  // ── 3. per-owner 隔离（v1 单 owner → API 层 owner_id scoping） ──
  test('隔离 · 未鉴权请求拿不到 owner 上传的 connector',
    ({ playwright }) => unauthCannotReadConnector(playwright));

  test('隔离 · 未鉴权不能 disconnect 或改 owner 上传 connector 的凭据',
    ({ playwright }) => unauthCannotMutateConnector(playwright));
});

const SSRF_REJECT_RE = /internal|loopback|private|not allowed|disallow|blocked/i;

async function ssrfServerUrlRejected(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  for (const url of INTERNAL_SERVER_URLS) {
    const res = await request.post(`${BACKEND}/api/admin/connectors`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: specWithServerURL(url) },
    });
    // the backend must refuse an internal base. 4xx (validation refusal) is the
    // contract; it must NOT 2xx and silently hold an internal-pointing connector
    // that a later consume would SSRF through.
    expect(res.status(), `internal server url must be rejected: ${url}`)
      .toBeGreaterThanOrEqual(400);
    expect(res.status(), `internal server url must not 5xx: ${url}`).toBeLessThan(500);
    const text = await res.text();
    expect(text, `reject reason names the address policy: ${url}`).toMatch(SSRF_REJECT_RE);
    expect(text, 'no raw go panic / stack trace leaked').not.toContain('goroutine');
  }
  await request.dispose();
}

async function ssrfOAuthUrlRejected(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  // both URLs point at cloud-metadata; a server-side OAuth dance would fetch
  // them. The backend must refuse — either at upload, or at connect time.
  const spec = specWithOAuthURLs('http://169.254.169.254/authorize', 'http://169.254.169.254/token');
  const upload = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: { spec },
  });
  if (upload.status() >= 400) {
    // refused at upload — acceptable and preferred.
    expect(await upload.text()).toMatch(SSRF_REJECT_RE);
    await request.dispose();
    return;
  }
  // accepted at upload → must refuse to start the dance against an internal token URL.
  const id = (await upload.json() as { id: string }).id;
  const connect = await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  expect(connect.status(), 'connect must refuse internal oauth URL').toBeGreaterThanOrEqual(400);
  expect(connect.status()).toBeLessThan(500);
  expect(await connect.text()).toMatch(SSRF_REJECT_RE);
  await request.dispose();
}

async function ssrfRejectLeavesNoConnector(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
    data: { spec: specWithServerURL('http://169.254.169.254/latest/meta-data/') },
  });
  // a rejected SSRF spec must not have been persisted as a connector row.
  const list = await request.get(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(list.status()).toBe(200);
  expect(await list.text(), 'rejected internal spec left no connector behind')
    .not.toContain('169.254.169.254');
  await request.dispose();
}

// ── 1b. consume-time SSRF ──
// Upload + credential a connector whose *static* URLs are benign, then drive the
// runtime path (diag list-busy) and prove the backend refuses the internal hop the
// provider tries to redirect into — no SSRF at consume time, no crash, no leak.
async function ssrfConsumeTimeRejected(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  // passes upload (public-looking base) + credentials cleanly.
  const id = await uploadSpec(request, csrf, specConsumeRedirectsInternal());
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { api_key: 'benign-key' },
  });

  // runtime consume: the upstream 302s toward 169.254.169.254 → the HTTP runtime
  // must refuse to follow the internal redirect, surfacing a policy refusal (not a
  // 200 with metadata, not a 5xx stack).
  const diag = await request.post(`${BACKEND}/internal/diag/connector/${id}/list-busy`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  expect(diag.status(), 'runtime refuses internal redirect').toBeGreaterThanOrEqual(400);
  expect(diag.status(), 'runtime refusal is not a crash').toBeLessThan(500);
  const text = await diag.text();
  expect(text, 'refusal names the address policy').toMatch(SSRF_REJECT_RE);
  expect(text, 'no metadata exfiltrated').not.toContain('meta-data');
  expect(text, 'no raw go panic / stack').not.toContain('goroutine');
  await request.dispose();
}

// During the server-side dance, the provider tries to redirect the callback /
// token exchange to an internal address. The backend must refuse — at connect
// (start of dance) or when following the redirect — never let the dance hop inward.
async function ssrfOAuthDanceRedirectRejected(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const id = await uploadSpec(request, csrf, specOAuthDanceRedirectsInternal());
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { client_id: 'cid', client_secret: 'sec' },
  });
  // start the dance; the mock authorize/token redirect toward internal. The dance
  // must NOT land a connection by following an internal redirect.
  const connect = await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (connect.status() >= 400) {
    // refused up front — acceptable and preferred.
    expect(connect.status()).toBeLessThan(500);
    expect(await connect.text()).toMatch(SSRF_REJECT_RE);
    await request.dispose();
    return;
  }
  // dance was allowed to start → the redirect-following step must have refused, so
  // the connector must end up NOT connected (the internal hop never completed).
  const st = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const body = await st.json() as { connected: boolean };
  expect(body.connected, 'dance must not connect via an internal redirect').toBe(false);
  await request.dispose();
}

async function secretMaskedInAdminReads(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const id = await uploadSpec(request, csrf, SPEC_BENIGN_APIKEY);

  const credRes = await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { api_key: BENIGN_API_KEY_SECRET },
  });
  expect(credRes.status(), 'credentials accepted').toBe(200);
  // the write-response itself must not echo the plaintext back.
  expect(await credRes.text(), 'credentials POST response masks the secret')
    .not.toContain(BENIGN_API_KEY_SECRET);

  const status = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(status.status()).toBe(200);
  expect(await status.text(), 'secret not in /status').not.toContain(BENIGN_API_KEY_SECRET);

  const list = await request.get(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(list.status()).toBe(200);
  expect(await list.text(), 'secret not in connectors list').not.toContain(BENIGN_API_KEY_SECRET);
  await request.dispose();
}

async function secretNotInVisitorSurface(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const id = await uploadSpec(request, csrf, SPEC_BENIGN_APIKEY);
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { api_key: BENIGN_API_KEY_SECRET },
  });
  // the public instance descriptor is the visitor-facing connector surface; it
  // may advertise *capabilities* but never the owner's stored secret.
  const inst = await request.get(`${BACKEND}/api/v1/instance`);
  expect(inst.status()).toBe(200);
  expect(await inst.text(), 'secret not in public /api/v1/instance')
    .not.toContain(BENIGN_API_KEY_SECRET);
  await request.dispose();
}

async function unauthCannotReadConnector(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const id = await uploadSpec(request, csrf, SPEC_BENIGN_APIKEY);
  await request.dispose();

  // a fresh context with no admin session / no csrf is the "another owner /
  // outsider" stand-in for single-owner v1: admin connector routes are
  // owner-scoped, so this must be refused, not served.
  const anon = await playwright.request.newContext();
  const list = await anon.get(`${BACKEND}/api/admin/connectors`);
  expect([401, 403], 'unauthenticated list refused').toContain(list.status());
  const status = await anon.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  expect([401, 403], 'unauthenticated status refused').toContain(status.status());
  await anon.dispose();
}

async function unauthCannotMutateConnector(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const id = await uploadSpec(request, csrf, SPEC_BENIGN_APIKEY);
  await request.dispose();

  const anon = await playwright.request.newContext();
  // no csrf, no session → mutating routes must refuse (owner_id scoping + CSRF),
  // never silently disconnect or overwrite another owner's creds.
  const cred = await anon.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    data: { api_key: 'attacker-key' },
  });
  expect([401, 403], 'unauthenticated credentials write refused').toContain(cred.status());
  const dis = await anon.delete(`${BACKEND}/api/admin/connectors/${id}/disconnect`);
  expect([401, 403], 'unauthenticated disconnect refused').toContain(dis.status());
  await anon.dispose();
}

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
