// connector-protocol-smtp.spec.ts — #155 §8 section E (protocol SMTP) target contract (RED).
//
// Business story: the owner installs a kind=protocol SMTP connector to fill the "mail"
// category slot. Unlike an openapi connector (whose form is derived from the spec's
// securitySchemes), SMTP is a **built-in implementation** — its credential form is
// **fixed and hand-defined**, 6 fields (host/port/username/password/from/tls, see
// docs/design/connector.md §2 smtpForm), never derived from any spec. Owner picks "SMTP
// (protocol)" -> the fixed form renders -> fills it in -> clicks connect (no OAuth dance,
// saving the credential connects immediately) -> the backend really opens an SMTP
// connection to run a connection test -> Connected.
//
// Covers "protocol connector UI assembly + fixed form + connection test" (§8 section E).
// Implemented, really compiles, really runs, really green (the form renders from the
// generic protocol descriptor; was originally a RED contract, flipped green with the
// fixme removed after implementation).
//
// Real services: the backend dials mail-mock's SMTP port (1025) -> forwards to Mailpit.
// Error paths use mail-mock's fault control plane + deliberately wrong host/port/auth/tls
// to force connection failures. Never touches a real external SMTP server.
//
// §8 interface sketch alignment:
//   testid: connector-add-open / connector-card-smtp / connector-scheme-select
//           / connector-field-{key} / connector-connect-button
//           / connector-status(connected|not) / connector-config-save
//   REST  : POST /api/admin/connectors (built from the built-in protocol)
//           POST …/{id}/credentials / POST …/{id}/connect (= the connection test) / GET …/{id}/status

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// The backend dials mail-mock's SMTP port (1025) within the compose network -> Mailpit. A
// healthy SMTP endpoint.
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mail-mock';
const SMTP_PORT = 1025;

const OWNER = {
  email: 'smtp-protocol@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'smtpowner',
  fullName: 'SMTP Owner',
};

// The SMTP protocol connector's fixed credential fields (hand-defined, docs §2
// smtpForm); installing any SMTP always fills these 6, never derived from a spec.
const SMTP_FIELDS = {
  host: SMTP_HOST,
  port: String(SMTP_PORT),
  username: '',
  password: '',
  from: 'noreply@standmeet.test',
  tls: 'none', // mail-mock's 1025 is plaintext
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector · protocol SMTP (kind=protocol, fixed credential form)', () => {
  // Covers protocol(SMTP) connector UI assembly + the fixed form + the connection test
  // (connector.md §8 section E). Implemented, green.

  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // —— happy: the fixed form renders (NOT derived from a spec) -> fill it in ->
  // connection test -> Connected ——
  test('pick SMTP(protocol) → 6 fixed fields render (not spec-derived) → fill → connect → Connected',
    async ({ adminPage }) => {
      await openSMTPForm(adminPage);
      await assertFixedFormNotDerived(adminPage);

      await fillSMTPForm(adminPage, SMTP_FIELDS);
      await adminPage.getByTestId('connector-config-save').click();

      // protocol has no OAuth dance: clicking connect = running a real SMTP connection test.
      await adminPage.getByTestId('connector-connect-button').click();
      await expect(adminPage.getByTestId('connector-status')).toHaveText(/connected|已连接/i);
    });

  // —— err: bad host/port -> connection test fails, friendly UI error, never Connected ——
  test('wrong host/port → connection test fails → friendly error, status stays not connected',
    async ({ adminPage }) => {
      await openSMTPForm(adminPage);
      await fillSMTPForm(adminPage, {
        ...SMTP_FIELDS, host: 'no-such-smtp-host.invalid', port: '2525',
      });
      await adminPage.getByTestId('connector-config-save').click();
      await adminPage.getByTestId('connector-connect-button').click();

      // Connection fails: a visible friendly error, status never flips to connected, no
      // raw stack trace / technical jargon.
      const err = adminPage.getByTestId('connector-error');
      await expect(err).toBeVisible();
      await expect(err).toHaveText(/couldn'?t connect|connection|unreachable|无法连接|连接失败/i);
      await expect(err).not.toHaveText(/panic|goroutine|stack|ECONNREFUSED|dial tcp/i);
      await expect(adminPage.getByTestId('connector-status')).not.toHaveText(/connected|已连接/i);
    });

  // —— err: bad SMTP auth config -> connection test fails -> not connected —— (asserted
  // at the API layer, avoiding UI flake)
  // Note: mail-mock is plaintext and doesn't advertise STARTTLS/AUTH, and the backend
  // uses net/smtp's PlainAuth (which refuses to send credentials over a non-localhost
  // plaintext connection). So what's actually verified here is real, general behavior —
  // **when an SMTP connection with credentials cannot complete the auth/TLS handshake,
  // the connection test fails gracefully under the auth/tls category, status stays
  // unconnected, and the raw protocol code/stack is never leaked**.
  // (The mock-side 535 is not faked: that code path is fundamentally unreachable given
  // PlainAuth's plaintext restriction.)
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

  // —— err: TLS mismatch (endpoint is plaintext but tls is requested) -> handshake fails
  // -> connection test fails ——
  test('TLS mismatch (implicit tls required on a plaintext endpoint) → handshake fails → status not connected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const id = await createSMTPConnector(request);
      // A healthy plaintext endpoint (1025), but implicit tls is chosen -> TLS handshake fails.
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

// ─── helpers (inline; promote to fixtures/connector-protocol.ts once the implementation
// turns green) ───

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

// openSMTPForm — go to connectors -> open the add modal -> click the SMTP(protocol) card
// -> the fixed form renders.
async function openSMTPForm(page: Page): Promise<void> {
  await openConnectors(page);
  await page.getByTestId('connector-add-open').click();
  // In the catalog, the protocol connector is the "SMTP" card; clicking it renders the
  // fixed form.
  await page.getByTestId('connector-card-smtp').click();
}

// assertFixedFormNotDerived — a protocol connector has **no spec input / no scheme
// selector**: the form is fixed and hand-defined, never derived from securitySchemes
// (this is the crux that distinguishes it from the openapi path).
async function assertFixedFormNotDerived(page: Page): Promise<void> {
  await expect(page.getByTestId('connector-spec-input')).toHaveCount(0);
  await expect(page.getByTestId('connector-scheme-select')).toHaveCount(0);
  for (const key of Object.keys(SMTP_FIELDS)) {
    await expect(page.getByTestId(`connector-field-${key}`)).toBeVisible();
  }
  // password is a secret (type=password), tls is a select.
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

// createSMTPConnector — POST /api/admin/connectors to create a row from the built-in
// protocol(SMTP), returning the connector id (§8 generalizes the gcal pattern to {id}).
// kind=protocol carries no spec.
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
