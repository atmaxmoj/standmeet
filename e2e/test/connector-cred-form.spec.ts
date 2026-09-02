// connector-cred-form.spec.ts —— #155 area B (credential form derivation) RED contract.
//
// Business story: the owner pastes an OpenAPI 3.0 spec into /admin/connectors → the backend
// reads `components.securitySchemes` → derives a CredentialForm descriptor → the frontend's
// generic renderer draws the matching fields based on AuthType (no hand-written form per
// connector). This area only pins down "how the form derives from the spec and renders
// correctly"; the connect action itself (the OAuth dance / storing secrets) belongs to area D.
//
// Aligned with docs/design/connector.md §4 (auth type → field table) + §7 decision #3
// (owner picks among multiple schemes in the UI) + §8 area B testids
// (connector-spec-input / connector-scheme-select / connector-field-{key} /
// connector-needs-dance / connector-status). connector-connect-button belongs to area D:
// connecting needs a connector id, and this form runs **before** the connector is assembled (F-C-24).
//
// Covers the spec-driven credential form derivation UI (§8 area B). Implemented, green
// (originally a RED contract, turned green after implementation).

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
// renders that scheme's fields (form is dynamic to the choice; §7 decision #3).
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

// openIdConnect — derived form looks like oauth2 (client_id/secret + Connect);
// a discovery-URL note points at the openIdConnectUrl. token is NOT a field.
const SPEC_OIDC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'OIDC API', version: '1.0.0' },
  servers: [{ url: 'https://api.oidc.example.com' }],
  paths: { '/me': { get: { operationId: 'me.get', security: [{ oidc: ['openid', 'profile'] }], responses: { '200': { description: 'ok' } } } } },
  components: {
    securitySchemes: {
      oidc: {
        type: 'openIdConnect',
        openIdConnectUrl: 'https://api.oidc.example.com/.well-known/openid-configuration',
      },
    },
  },
});

// apiKey in: query — single key field; UI must show it goes in the QUERY (param
// name api_key), not a header (contrast with SPEC_APIKEY above which is header).
const SPEC_APIKEY_QUERY = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Query ApiKey API', version: '1.0.0' },
  servers: [{ url: 'https://api.qk.example.com' }],
  paths: { '/data': { get: { operationId: 'data.get', security: [{ apiKey: [] }], responses: { '200': { description: 'ok' } } } } },
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'query', name: 'api_key' },
    },
  },
});

// oauth2 with many scopes — the scope multi-select must list EVERY declared scope
// (not just the ones referenced by one operation).
const SPEC_OAUTH2_MULTISCOPE = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Multi-scope OAuth2 API', version: '1.0.0' },
  servers: [{ url: 'https://api.ms.example.com/v1' }],
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
            authorizationUrl: 'https://api.ms.example.com/oauth/authorize',
            tokenUrl: 'https://api.ms.example.com/oauth/token',
            scopes: {
              'cal.read': 'Read calendar',
              'cal.write': 'Write calendar',
              'contacts.read': 'Read contacts',
              'profile': 'Profile info',
            },
          },
        },
      },
    },
  },
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

test.describe('connector · credential form derived from spec · happy (area B)', () => {
  // Covers spec-driven credential form derivation (docs/design/connector.md §4/§8 area B). Implemented, green.

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

      // oauth2 needs the dance → the form says so. It is a note, not a button: connecting needs
      // the connector's id, which does not exist until it is assembled, so the button that used to
      // sit here had no handler and could never have one (F-C-24).
      await expect(page.getByTestId('connector-needs-dance')).toBeVisible();
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

      // no dance → no authorization note (just save the key).
      await expect(page.getByTestId('connector-needs-dance')).toHaveCount(0);
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

      // §7 decision #3: a scheme selector appears when >1 scheme is available.
      const select = page.getByTestId('connector-scheme-select');
      await expect(select).toBeVisible();

      // pick oauth2 → oauth fields render, no apiKey field.
      await select.selectOption('oauth2');
      await expect(page.getByTestId('connector-field-client_id')).toBeVisible();
      await expect(page.getByTestId('connector-field-client_secret')).toBeVisible();
      await expect(page.getByTestId('connector-needs-dance')).toBeVisible();
      await expect(page.getByTestId('connector-field-key')).toHaveCount(0);

      // pick apiKey → the form swaps to the key field, oauth fields gone.
      await select.selectOption('apiKey');
      await expect(page.getByTestId('connector-field-key')).toBeVisible();
      await expect(page.getByTestId('connector-field-client_id')).toHaveCount(0);
      await expect(page.getByTestId('connector-needs-dance')).toHaveCount(0);
      // apiKey here is in query param api_key — surfaced to owner.
      await expect(page.getByTestId('connector-cred-form')).toContainText(/query/i);
      await expect(page.getByTestId('connector-cred-form')).toContainText(/api_key/);
    });
});

// Extra area-B corners (mentioned in the §4 table but not covered above): openIdConnect
// rendering like oauth2 / apiKey in:query showing its location / oauth2 listing every scope.
// A separate describe keeps the callback above at ≤70 lines.
test.describe('connector · credential form derived from spec · corner (area B)', () => {

  test.beforeAll(async ({ playwright }) => { await claimOwner(playwright); });

  // ── happy: openIdConnect → renders like oauth2 ───────────────────────────
  test('openIdConnect spec → client_id + client_secret + Connect + discovery-URL note',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_OIDC);

      // OIDC is an oauth2 superset → same owner-facing client creds, no token field.
      await expect(page.getByTestId('connector-field-client_id')).toBeVisible();
      await expect(page.getByTestId('connector-field-client_secret')).toBeVisible();
      await expect(page.getByTestId('connector-field-token')).toHaveCount(0);

      // needs the dance → the authorization note is present (like oauth2).
      await expect(page.getByTestId('connector-needs-dance')).toBeVisible();

      // a discovery-URL note points owner at the openIdConnectUrl.
      const form = page.getByTestId('connector-cred-form');
      await expect(form).toContainText(/\.well-known\/openid-configuration/);
    });

  // ── happy: apiKey in query (vs header) ───────────────────────────────────
  test('apiKey (in: query) spec → single key field + shows it goes in the query',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_APIKEY_QUERY);

      await expect(page.getByTestId('connector-field-key')).toBeVisible();

      // UI tells owner the key rides in the query string as api_key, NOT a header.
      const form = page.getByTestId('connector-cred-form');
      await expect(form).toContainText(/query/i);
      await expect(form).toContainText(/api_key/);
      await expect(form).not.toContainText(/header/i);

      // no dance → no authorization note.
      await expect(page.getByTestId('connector-needs-dance')).toHaveCount(0);
    });

  // ── happy: oauth2 multiple scopes → all listed in multi-select ───────────
  test('oauth2 multi-scope spec → scope picker lists every declared scope',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_OAUTH2_MULTISCOPE);

      const scope = page.getByTestId('connector-field-scope');
      await expect(scope).toBeVisible();
      // every scope declared on the flow shows up, not just the op-referenced one.
      await expect(scope).toContainText(/cal\.read/);
      await expect(scope).toContainText(/cal\.write/);
      await expect(scope).toContainText(/contacts\.read/);
      await expect(scope).toContainText(/profile/);
    });
});

test.describe('connector · credential form derived from spec · err (area B)', () => {

  test.beforeAll(async ({ playwright }) => { await claimOwner(playwright); });

  // ── no securityScheme → manual-auth fallback, NOT a refusal ──────────────
  //
  // This used to assert a "no supported auth" dead end. F-H-2 (b956105b) deliberately changed it:
  // real vendor specs often leave components.securitySchemes empty (Cal.com v2 does) while the API
  // still wants `Authorization: Bearer …`, so refusing outright made those connectors
  // unusable. The owner is now offered the three generic schemes (manual:bearer / manual:apikey /
  // manual:basic) to pick from. Asserting the fallback is stronger than asserting the old refusal:
  // it pins that the owner has a way FORWARD, which is the actual product requirement.
  test('spec with no securityScheme → manual-auth fallback offers pickable schemes',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_NO_AUTH);

      const status = page.getByTestId('connector-status');
      await expect(status).toContainText(/declares no authentication/i);
      // The dead end is gone: the owner can pick a scheme and proceed.
      await expect(status).toContainText(/pick one below/i);
    });

  // ── err: unsupported auth type ───────────────────────────────────────────
  test('spec with unsupported auth type (mutualTLS) → rejected/flagged',
    async ({ adminPage: page }) => {
      await pasteSpec(page, SPEC_UNSUPPORTED);

      const status = page.getByTestId('connector-status');
      await expect(status).toContainText(/unsupported|not supported|不支持|mutualTLS/i);
      // unsupported scheme must not be rendered as a usable field.
      await expect(page.getByTestId('connector-field-token')).toHaveCount(0);
      await expect(page.getByTestId('connector-needs-dance')).toHaveCount(0);
    });
});

// pasteSpec —— navigate to the connectors area by clicking (no page.goto),
// open the spec input, paste a spec, and trigger derivation. The derived
// credential form / status is what each test asserts against.
async function pasteSpec(page: Page, spec: string): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  // spec-paste input lives in the add panel (same entry as spec-ingest).
  await page.getByTestId('connector-add-open').click();
  await page.getByTestId('connector-spec-input').fill(spec);
  // derivation is triggered by leaving the field; assertions then poll the form.
  await page.getByTestId('connector-spec-input').blur();
}
