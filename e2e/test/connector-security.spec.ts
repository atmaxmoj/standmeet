// connector-security.spec.ts -- #155 §8 zone H (security). Implemented, green
// (originally a RED contract).
//
// "The owner uploads an arbitrary OpenAPI spec" forces out three security gates; these
// three must hold in a spec-driven connector implementation, and this file pins them
// down (originally RED targets, went green once implemented):
//
//   1. Warning: SSRF -- if the uploaded spec's `servers[].url` (or oauth2's
//      token/authorize URL) points at loopback / link-local / a private network, the
//      backend must **refuse assembly or refuse to make the outbound request**. The
//      owner must not be able to use the "self-hosted, no central review" upload
//      channel to turn the instance into an SSRF pivot into the internal network
//      (cloud metadata 169.254.169.254 / localhost / 10.x / 127.x).
//   2. Credentials never leak -- once a user-uploaded openapi connector is connected,
//      its stored client_secret / api key must be **masked** wherever it's returned via
//      list / status / any admin read path; the raw value must never appear there, and
//      never appear on any visitor-visible surface. Extends the spirit of
//      handle_contract_test.go + connector-secret-no-leak.spec.ts to "uploaded" connectors.
//   3. Per-owner isolation -- an uploaded connector and its connection belong to one
//      owner. v1 is single-owner, so this pins owner_id scoping at the API layer:
//      unauthenticated / cross-session requests can neither read nor use it.
//
// Aligned with the §8 interface sketch:
//   POST   /api/admin/connectors            (create from a spec)
//   POST   /api/admin/connectors/{id}/credentials
//   POST   /api/admin/connectors/{id}/connect      (start oauth)
//   GET    /api/admin/connectors/{id}/status
//   GET    /api/admin/connectors                    (list)
//   DELETE /api/admin/connectors/{id}/disconnect
//
// The "create any connector via POST from a spec" upload path is implemented; this
// test actually compiles, actually runs, and is actually green.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
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
    // The unified upload contract is {spec object, binding object} (the spec is
    // inlined as a JSON string above; here it's parsed back into an object).
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
  // #155 §8 H implemented: security gates for spec-driven connector uploads
  // (assembly-time SSRF static blocking + credential masking + owner_id scoping). The
  // two consume-time / OAuth-dance internal-net redirect cases (the runtime dialer
  // guard is built, but a mock 302->internal-net endpoint is still missing) stay fixme
  // for now.

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

  // -- 2. credentials never leak (extends handle_contract / secret-no-leak to user-uploaded) --
  test('no credential leak · an uploaded connector api key is masked in status/list, raw never returned',
    ({ playwright }) => secretMaskedInAdminReads(playwright));

  test('no credential leak · an uploaded connector secret never appears on any visitor-visible surface',
    ({ playwright }) => secretNotInVisitorSurface(playwright));

  // -- 1b. consume-time SSRF (upload/connect passed; only the runtime call hits the internal net) --
  // Runtime dialer guard (GuardedHTTPClient blocks resolving to the internal net +
  // refuses internal-net redirects) + a mock 302->internal-net endpoint.
  test('SSRF · a runtime API call resolving/redirecting to an internal net → runtime refuses egress',
    ({ playwright }) => ssrfConsumeTimeRejected(playwright));

  test('SSRF · provider redirecting the callback/token exchange to an internal net mid-dance → rejected',
    ({ playwright }) => ssrfOAuthDanceRedirectRejected(playwright));

  // -- 2b. after the instance key is rotated (check 3 / F-C-41) --
  test('rotation · a credential this instance can no longer read asks for a reconnect',
    ({ playwright }) => unreadableCredentialAsksReconnect(playwright));

  test('rotation · one unreadable connector does not take the whole list down',
    ({ playwright }) => unreadableCredentialDoesNotSinkTheList(playwright));

  // -- 3. per-owner isolation (v1 single-owner -> owner_id scoping at the API layer) --
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
  const diag = await diagInvoke(request, csrf, id, 'calendar', 'free_busy', {});
  expect(diag.status, 'runtime refuses internal redirect').toBeGreaterThanOrEqual(400);
  expect(diag.status, 'runtime refusal is not a crash').toBeLessThan(500);
  const text = diag.text;
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

// ── check 3 / F-C-41 ──────────────────────────────────────────────────────
//
// **Why corrupt a byte instead of actually rotating INSTANCE_SECRET**: AES-GCM's auth
// failure makes "wrong key" and "tampered ciphertext" **cryptographically the same
// event** -- the product gets back the same `cryptobox.ErrTampered` either way, cannot
// tell them apart, and shouldn't pretend to. So corrupting one byte walks exactly the
// same branch as rotation. The item's own Mock gap also defines this step as
// "reproduce it in the harness: encrypt with one key, boot with another".
//
// This was actually rotated once in prod (swapping `.env`'s INSTANCE_SECRET + rebuilding
// the backend), and this is exactly what was seen: the backend came up fine, but the
// card on `/admin/connectors` said `not connected`, the credentials box was empty, and
// **there was not one word of explanation** -- while the ciphertext and `connected_at`
// were both still sitting in the DB.
//
// **The criterion asserts "the owner gets a sentence they can act on"**, not "it didn't
// crash". The reverse case (a connector that was genuinely never connected still just
// says not connected, without demanding a reconnect) is below; without it, an
// implementation that tells every connector to reconnect could also go green.
const RECONNECT_RE = /reconnect|connect it again|no longer read/i;

// corruptStoredCredential -- flips one byte of a connector's stored ciphertext.
// This is exactly why `execSQL` exists: no API can build this pre-state, and none should.
function corruptStoredCredential(connectorID: string): void {
  execSQL(
    `UPDATE owner_connectors
       SET credentials_enc = overlay(credentials_enc placing '\\x00'::bytea from 1 for 1)
     WHERE connector_id = '${connectorID}'`,
  );
}

async function unreadableCredentialAsksReconnect(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const id = await uploadSpec(request, csrf, SPEC_BENIGN_APIKEY);
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { api_key: BENIGN_API_KEY_SECRET },
  });
  // Prove it's "connected" first -- otherwise a red below might just mean this
  // connector was never configured (a false red).
  const before = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(before.status(), 'the connector must really be configured first').toBe(200);

  corruptStoredCredential(id);

  const after = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(
    after.status(),
    'an unreadable credential is a state to explain, not a server error',
  ).toBe(200);
  expect(
    await after.text(),
    'the owner must be told this instance can no longer read the credential',
  ).toMatch(RECONNECT_RE);
  await request.dispose();
}

// unreadableCredentialDoesNotSinkTheList -- the more glaring half of what happened in
// prod: **one** unreadable connector took `connectors.list` down with a 500, so
// **every card** rendered as "never connected".
async function unreadableCredentialDoesNotSinkTheList(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const broken = await uploadSpec(request, csrf, SPEC_BENIGN_APIKEY);
  await request.post(`${BACKEND}/api/admin/connectors/${broken}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { api_key: BENIGN_API_KEY_SECRET },
  });
  corruptStoredCredential(broken);

  const list = await request.get(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(
    list.status(),
    'one unreadable row must not take the whole connectors surface down',
  ).toBe(200);
  expect(
    await list.text(),
    'the list must name the unreadable one rather than silently omit it',
  ).toMatch(RECONNECT_RE);
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

// diagInvoke -- hits the owner-authed connector diag endpoint. **This is a back door
// that bypasses the real path** (the real path is visitor chat -> agent -> booker
// sandbox -> connector.invoke), so it's **deliberately** kept inline here rather than
// extracted into a shared fixture: extracting it would license the bypass, making it
// easier for the next person to reach for it. Whether this back door itself stays or
// goes is tracked in the "diag back door" task.
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
