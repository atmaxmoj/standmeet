// supplier-protocol-smtp.spec.ts — the SMTP mail supplier's connection test + friendly, classified
// errors.
//
// Business story: the owner fills in the SMTP mail supplier's connection fields
// (host/port/username/password/from/tls) and connects it. There is no OAuth dance — saving the
// credentials and connecting runs a real SMTP connection test, and coming back connected means the
// server answered. SMTP is a shipped **block** now (like CalDAV: an app on a protocol, sandboxed,
// carrying no host code), so its form is derived from the block's declared config and its connection
// test runs the block's `verify` tool. The block OWNS its error classification — a wrong TLS
// setting, bad credentials, or an unreachable host each come back as a distinct, friendly sentence,
// which the admin surfaces verbatim (never a raw stack / protocol code).
//
// Covers "the mail supplier's connection test + friendly classified failures", at the API level
// (the real /credentials → /connect → /status flow the panel drives). The credential *form*
// rendering is covered by supplier-builtin-credform.
//
// Real services: the backend dials mail-mock's SMTP port (1025) → Mailpit — a healthy plaintext
// endpoint. Error paths use deliberately wrong host/port/auth/tls to force real connection failures.
// Never touches a real external SMTP server.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// The backend dials mail-mock's SMTP port (1025) within the compose network → Mailpit. A healthy
// SMTP endpoint.
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mail-mock';

// SMTP is a shipped built-in block; the owner connects it under its manifest id, like caldav.
const SMTP_ID = 'smtp';

const OWNER = {
  email: 'smtp-block@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'smtpowner',
  fullName: 'SMTP Owner',
};

// The SMTP supplier's connection fields (the block's declared config keys). mail-mock's 1025 is
// plaintext with no auth, so tls is "none" and there are no credentials.
const SMTP_FIELDS = {
  host: SMTP_HOST,
  port: '1025',
  username: '',
  password: '',
  from_address: 'noreply@standmeet.test',
  from_name: 'StandMeet',
  tls: 'none',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('supplier · SMTP block (connection test + friendly classified errors)', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // —— happy: healthy plaintext endpoint → connection test succeeds → Connected ——
  test('healthy endpoint → connect runs a real SMTP test → Connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await postCredentials(request, SMTP_ID, SMTP_FIELDS);
      const { status, body } = await postConnect(request, SMTP_ID);
      expect(status, 'a successful connect must not 5xx').toBeLessThan(500);
      expect(body.connected, 'healthy endpoint → connected').toBe(true);

      const st = await getStatus(request, SMTP_ID);
      expect(st.connected).toBe(true);
      await request.dispose();
    });

  // —— err: bad host/port → connection test fails → friendly connect error, not connected ——
  test('wrong host/port → connection test fails → friendly error, status stays not connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await postCredentials(request, SMTP_ID, {
        ...SMTP_FIELDS, host: 'no-such-smtp-host.invalid', port: '2525',
      });
      const { status, body } = await postConnect(request, SMTP_ID);

      expect(status, 'a connect failure must not be a server crash').toBeLessThan(500);
      expect(body.connected, 'unreachable → not connected').toBe(false);
      expect(`${body.error ?? ''}`, 'friendly connect error')
        .toMatch(/couldn'?t connect|connection|unreachable|无法连接|连接失败/i);
      expect(`${body.error ?? ''}`, 'does not leak the raw protocol code/stack')
        .not.toMatch(/panic|goroutine|stack|ECONNREFUSED|dial tcp/i);

      const st = await getStatus(request, SMTP_ID);
      expect(st.connected).toBe(false);
      await request.dispose();
    });

  // —— err: bad SMTP auth config → handshake cannot complete → not connected ——
  // mail-mock is plaintext and advertises neither STARTTLS nor AUTH, so requiring STARTTLS with
  // credentials cannot complete the handshake. What's verified is real, general behavior: when an
  // authenticated/secured SMTP handshake cannot complete, the connection test fails gracefully with
  // a friendly (auth/tls) reason, status stays unconnected, and no raw code/stack leaks.
  test('bad SMTP auth config (handshake cannot complete) → connection test fails → not connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await postCredentials(request, SMTP_ID, {
        ...SMTP_FIELDS, username: 'wrong-user', password: 'wrong-pass', tls: 'starttls',
      });
      const { status, body } = await postConnect(request, SMTP_ID);

      expect(status, 'an auth/tls failure must not be a server crash').toBeLessThan(500);
      expect(body.connected, 'handshake cannot complete → not connected').toBe(false);
      expect(`${body.error ?? ''}`, 'friendly auth/tls error')
        .toMatch(/auth|credential|password|tls|handshake|secure|认证|凭据/i);
      expect(`${body.error ?? ''}`, 'does not leak the raw protocol code/stack')
        .not.toMatch(/panic|goroutine|stack/i);

      const st = await getStatus(request, SMTP_ID);
      expect(st.connected).toBe(false);
      await request.dispose();
    });

  // —— err: TLS mismatch (implicit tls required on a plaintext endpoint) → handshake fails ——
  test('TLS mismatch (implicit tls on a plaintext endpoint) → handshake fails → status not connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // A healthy plaintext endpoint (1025), but implicit tls is chosen → the TLS handshake fails.
      await postCredentials(request, SMTP_ID, { ...SMTP_FIELDS, tls: 'tls' });
      const { status, body } = await postConnect(request, SMTP_ID);

      expect(status, 'a TLS handshake failure must not be a 5xx').toBeLessThan(500);
      expect(body.connected, 'TLS mismatch → not connected').toBe(false);
      expect(`${body.error ?? ''}`, 'friendly TLS error')
        .toMatch(/tls|encrypt|handshake|secure|加密|握手/i);
      expect(`${body.error ?? ''}`).not.toMatch(/panic|goroutine|stack/i);

      const st = await getStatus(request, SMTP_ID);
      expect(st.connected).toBe(false);
      await request.dispose();
    });
});

// ─── helpers ───

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

async function postCredentials(
  request: APIRequestContext, id: string, fields: Record<string, string>,
): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: connector connect flow (save smtp credentials) this spec exercises
  const res = await request.post(`${BACKEND}/api/admin/suppliers/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: fields,
  });
  if (res.status() !== 200) throw new Error(`smtp credentials: ${res.status()}`);
}

async function postConnect(
  request: APIRequestContext, id: string,
): Promise<{ status: number; body: ConnectResp }> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: connect returns status+body so the smtp tests assert the connect result
  const res = await request.post(`${BACKEND}/api/admin/suppliers/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  return { status: res.status(), body: await res.json() as ConnectResp };
}

async function getStatus(request: APIRequestContext, id: string): Promise<StatusResp> {
  const res = await request.get(`${BACKEND}/api/admin/suppliers/${id}/status`);
  if (res.status() !== 200) throw new Error(`smtp status: ${res.status()}`);
  return await res.json() as StatusResp;
}
