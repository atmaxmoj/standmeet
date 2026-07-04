// connector-security.spec.ts —— #155 §8 区 H（安全）。已实现，绿（原为 RED 契约）。
//
// 「owner 上传任意 OpenAPI spec」把三道安全门逼出来；这三道在 spec-driven
// connector 实现里必须成立，本文件钉住它们（原为 RED 靶子，实现后转绿）：
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
// 「从 spec POST 建任意 connector」的上传路径已实现，本测真编译、真跑、真绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  INTERNAL_SERVER_URLS, specWithServerURL, specWithOAuthURLs,
  specConsumeRedirectsInternal, specOAuthDanceRedirectsInternal,
  BENIGN_API_KEY_SECRET, SPEC_BENIGN_APIKEY, BENIGN_BINDING,
} from '@/fixtures/connector-security-specs';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'sec-connector@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'secconn',
  fullName: 'Security Connector Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// uploadSpec —— POST /api/admin/connectors from a raw spec string. Returns the
// new connector id (assigned by the backend). Throws on non-2xx so callers that
// expect success fail loudly; SSRF tests call the endpoint directly to inspect
// the rejecting status instead.
async function uploadSpec(
  request: APIRequestContext, csrf: string, spec: string,
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
    // 统一上传契约 {spec 对象, binding 对象}（spec 内联串成 JSON，这里解回对象）。
    data: { spec: JSON.parse(spec), binding: BENIGN_BINDING },
  });
  if (res.status() < 200 || res.status() >= 300) {
    throw new Error(`uploadSpec failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json() as { id?: string };
  if (!body.id) throw new Error('uploadSpec: response missing connector id');
  return body.id;
}

test.describe('connector · §8 area H security (SSRF / no credential leak / per-owner isolation)', () => {
  // #155 §8 H 落地：spec-driven connector 上传的安全门（装配期 SSRF 静态拦 + 凭据打码 +
  // owner_id scoping）。consume-time / OAuth-dance 重定向到内网的两条（运行期 dialer 守卫已建，
  // 但还缺 mock 的 302→内网 端点）暂留 fixme。

  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // ── 1. SSRF ──
  test('SSRF · servers[].url pointing at loopback/link-local/private net → reject assembly or egress',
    ({ playwright }) => ssrfServerUrlRejected(playwright));

  test('SSRF · oauth2 authorize/token URL pointing at an internal net → connect refuses egress',
    ({ playwright }) => ssrfOAuthUrlRejected(playwright));

  test('SSRF · no leftover connector after rejection (list excludes the rejected spec)',
    ({ playwright }) => ssrfRejectLeavesNoConnector(playwright));

  // ── 2. 凭据永不外泄（扩 handle_contract / secret-no-leak 到 user-uploaded） ──
  test('no credential leak · an uploaded connector api key is masked in status/list, raw never returned',
    ({ playwright }) => secretMaskedInAdminReads(playwright));

  test('no credential leak · an uploaded connector secret never appears on any visitor-visible surface',
    ({ playwright }) => secretNotInVisitorSurface(playwright));

  // ── 1b. consume-time SSRF（upload/connect 过了，运行时调用才打内网） ──
  // 运行期 dialer 守卫（GuardedHTTPClient 拦解析到内网 + 拒内网重定向）+ mock 的 302→内网 端点。
  test('SSRF · a runtime API call resolving/redirecting to an internal net → runtime refuses egress',
    ({ playwright }) => ssrfConsumeTimeRejected(playwright));

  test('SSRF · provider redirecting the callback/token exchange to an internal net mid-dance → rejected',
    ({ playwright }) => ssrfOAuthDanceRedirectRejected(playwright));

  // ── 3. per-owner 隔离（v1 单 owner → API 层 owner_id scoping） ──
  test('isolation · an unauthenticated request cannot read an owner-uploaded connector',
    ({ playwright }) => unauthCannotReadConnector(playwright));

  test('isolation · unauthenticated cannot disconnect or change an owner-uploaded connector credentials',
    ({ playwright }) => unauthCannotMutateConnector(playwright));
});

const SSRF_REJECT_RE = /internal|loopback|private|not allowed|disallow|blocked/i;

async function ssrfServerUrlRejected(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  for (const url of INTERNAL_SERVER_URLS) {
    const res = await request.post(`${BACKEND}/api/admin/connectors`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(specWithServerURL(url)) },
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
    headers: { 'X-Csrftoken': csrf }, data: { spec: JSON.parse(spec), binding: BENIGN_BINDING },
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
    data: { spec: JSON.parse(specWithServerURL('http://169.254.169.254/latest/meta-data/')) },
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
  const diag = await request.post(`${BACKEND}/api/admin/diag/connector/${id}/list-busy`, {
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
