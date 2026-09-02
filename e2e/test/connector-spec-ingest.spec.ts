// connector-spec-ingest.spec.ts —— #155 area A (spec ingest) RED contract.
//
// Story: the owner clicks "add" on /admin/connectors → pastes / uploads an OpenAPI
// spec → the backend parses it → a "connector candidate" appears (category + derived
// form entry). This is the first step of spec-driven assembly: feeding in whatever
// spec any given author wrote. Ingest is the area with the largest error/edge
// surface — malformed JSON, an unsupported version (Swagger 2.0), missing
// servers/operations, a failed URL fetch — all of these must give the owner a
// human-readable rejection reason on the UI, with no leaked stack trace and no
// silent swallowing.
//
// Aligned with docs/design/connector.md §8 area A + the target interface sketch:
//   testid: connector-add-open / connector-spec-input (paste or upload) /
//           connector-spec-submit / connector-spec-error / connector-candidate /
//           connector-spec-url-input / connector-spec-fetch-button
//   REST:   POST /api/admin/connectors (builds from a spec)
//
// Covers §8 area A spec ingest UI + backend. Already implemented, green (originally
// a RED contract, turned green once implemented).

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

// claimOwner —— beforeAll setup: resets the instance + claims the owner (shared
// across both describes).
async function claimOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

test.describe('connector · area A spec ingest · happy', () => {
  // Covers the spec-driven ingest UI/backend (docs/design/connector.md §8 area A).
  // Already implemented, green.

  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // happy —— pasting a valid OpenAPI 3.0 spec → parses successfully → a calendar
  // candidate appears.
  test('valid 3.0 spec pasted → parsed → shows calendar connector candidate', async ({
    adminPage: page,
  }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(validCalendarSpec());
    await page.getByTestId('connector-spec-submit').click();

    const candidate = page.getByTestId('connector-candidate');
    await expect(candidate).toBeVisible();
    // The parsed title/category gives the owner confirmation this is the one to install.
    await expect(candidate).toContainText(/calendar/i);
    await expect(page.getByTestId('connector-spec-error')).toHaveCount(0);
  });

  // happy —— the same spec through the "upload file" entry point (paste vs. upload
  // reach the same result).
  test('valid 3.0 spec file uploaded → parsed → candidate appears', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    // File upload goes through a dedicated file input (Playwright's setInputFiles only
    // recognizes input[type=file]; paste uses the connector-spec-input textarea).
    // onChange reads the file → the same validation path → candidate.
    await page.getByTestId('connector-spec-file').setInputFiles({
      name: 'calendar.openapi.json',
      mimeType: 'application/json',
      buffer: Buffer.from(validCalendarSpec(), 'utf-8'),
    });
    await expect(page.getByTestId('connector-candidate')).toContainText(/calendar/i);
  });
});

test.describe('connector · area A spec ingest · err', () => {
  // Covers the spec-driven ingest UI/backend (docs/design/connector.md §8 area A).
  // Already implemented, green.

  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // err —— malformed (invalid JSON / truncated) → rejected with a human-readable
  // "could not parse"-level error.
  test('malformed spec → rejected + human-readable parse error (no candidate shown)', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill('{ "openapi": "3.0.0", ');
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/parse|invalid|无法解析|格式/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— Swagger 2.0 → rejected, and the error must clearly name the version
  // (3.0/3.1 accepted, 2.0 rejected).
  test('non-3.0 (Swagger 2.0) → rejected + version hint', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(swagger20Spec());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/3\.0|version|版本/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // happy —— OpenAPI 3.1 is accepted too (F-H-1). The subset runtime reads
  // (paths/operations, requestBody.required, securitySchemes, servers) has the same
  // shape in 3.0 and 3.1, so a 3.1 vendor spec (e.g. cal.com v2) can be installed.
  test('valid 3.1 spec pasted → parsed → shows connector candidate (F-H-1)',
    async ({ adminPage: page }) => {
      await openSpecPaste(page);
      await page.getByTestId('connector-spec-input').fill(openapi31Spec());
      await page.getByTestId('connector-spec-submit').click();

      await expect(page.getByTestId('connector-candidate')).toBeVisible();
      await expect(page.getByTestId('connector-spec-error')).toHaveCount(0);
    });

  // err —— no servers → rejected (runtime has no base URL, can't call the API).
  test('missing servers → rejected + points out missing servers', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specMissingServers());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/servers/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— has servers but paths is empty (no operations) → rejected (nothing to bind).
  test('no operations (empty paths) → rejected + points out missing operations', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specMissingOperations());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/operation|path/i);
  });

  // err —— given a spec URL but the fetch fails (unreachable) → the UI reports a fetch
  // failure, and never hangs.
  //
  // The address was changed from `http://127.0.0.1:9/...` to a **public** hostname
  // that can't resolve. The old one was a loopback address, and since F-C-23 the
  // outbound gate correctly names it as an **address-policy rejection** instead of
  // vaguely reporting "unreachable" — so this assertion had been checking the old,
  // pre-fix behavior ever since, and nobody had rerun this spec against it. The
  // contrast between "blocked by policy" and "genuinely unreachable" lives in
  // connector-spec-fetch-names-the-refusal; this test only covers the latter.
  test('spec URL fetch fails → human-readable fetch error', async ({ adminPage: page }) => {
    await openConnectorAdd(page);
    // Switch to the "fetch spec from URL" entry point.
    await page.getByTestId('connector-spec-url-input')
      .fill('https://no-such-openapi-host.invalid/does-not-exist.openapi.json');
    await page.getByTestId('connector-spec-fetch-button').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/fetch|unreachable|failed|拉取|无法/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Area A extra corner cases (named in the §8 area A table but not covered above):
// oversized / duplicate operationId / missing operationId / YAML parsing / unresolved
// $ref. Already implemented, green.
// ──────────────────────────────────────────────────────────────────────────
test.describe('connector · area A spec ingest corner · err', () => {
  // Covers the spec-driven ingest UI/backend (docs/design/connector.md §8 area A).
  // Already implemented, green.

  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // err —— exceeds the size cap (valid JSON but huge) → rejected with a
  // human-readable size-limit error.
  test('oversized spec (over the size limit) → rejected + size-limit hint', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(oversizedSpec());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/size|too large|过大|上限|limit/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— two operations collide on the same operationId → rejected/flagged
  // (a binding can't point to it uniquely).
  test('duplicate operationId → rejected/flagged (cannot bind uniquely)', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(duplicateOperationIdSpec());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/duplicate|operationId|重复|唯一/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— an operation has no operationId (a binding needs it to point at) →
  // flagged as missing operationId.
  test('operation missing operationId → flagged (binding has no anchor)', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specMissingOperationId());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/operationId|operation id|缺.*id|missing/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });

  // err —— an external $ref (pointing to another file/URL) cannot be resolved →
  // returns a clear result (rejected, not silently swallowed).
  test('external/unresolved $ref → rejected + points out unresolvable reference', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specExternalRef());
    await page.getByTestId('connector-spec-submit').click();

    const err = page.getByTestId('connector-spec-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/\$ref|reference|引用|resolve|unresolved/i);
    await expect(page.getByTestId('connector-candidate')).toHaveCount(0);
  });
});

test.describe('connector · area A spec ingest corner · happy', () => {

  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // happy —— YAML (not JSON) goes through the same parse path → parses successfully →
  // a candidate appears.
  test('valid 3.0 YAML spec → parsed via the same path → candidate appears', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(validCalendarSpecYaml());
    await page.getByTestId('connector-spec-submit').click();

    await expect(page.getByTestId('connector-candidate')).toContainText(/calendar/i);
    await expect(page.getByTestId('connector-spec-error')).toHaveCount(0);
  });

  // happy —— an internal $ref (same document, #/components/...) → resolves →
  // a candidate appears.
  test('internal $ref (same document) → resolves → candidate appears', async ({ adminPage: page }) => {
    await openSpecPaste(page);
    await page.getByTestId('connector-spec-input').fill(specInternalRef());
    await page.getByTestId('connector-spec-submit').click();

    await expect(page.getByTestId('connector-candidate')).toBeVisible();
    await expect(page.getByTestId('connector-spec-error')).toHaveCount(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Local helpers (to be promoted to a shared fixture once implementation lands:
// openConnectorAdd / openSpecPaste + sample spec strings).
// ──────────────────────────────────────────────────────────────────────────

// openConnectorAdd —— navigates into the connectors area from the known entry point
// and opens add (never page.goto).
async function openConnectorAdd(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  await page.getByTestId('connector-add-open').click();
}

// openSpecPaste —— opens add and ensures the "paste/upload spec" input is visible.
async function openSpecPaste(page: Page): Promise<void> {
  await openConnectorAdd(page);
  await expect(page.getByTestId('connector-spec-input')).toBeVisible();
}

// validCalendarSpec —— the minimal valid OpenAPI 3.0 calendar spec (servers +
// freebusy operation + securitySchemes — enough to derive a form + candidate
// category).
function validCalendarSpec(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Acme Calendar', version: '1.0.0' },
    servers: [{ url: 'https://calendar.acme.test/v1' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          security: [{ oauth2: ['calendar.read'] }],
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
              authorizationUrl: 'https://calendar.acme.test/oauth/authorize',
              tokenUrl: 'https://calendar.acme.test/oauth/token',
              scopes: { 'calendar.read': 'read', 'calendar.write': 'write' },
            },
          },
        },
      },
    },
  });
}

// swagger20Spec —— Swagger 2.0 (`swagger: "2.0"`, no `openapi`) → must be rejected.
function swagger20Spec(): string {
  return JSON.stringify({
    swagger: '2.0',
    info: { title: 'Old API', version: '1.0.0' },
    host: 'api.acme.test',
    basePath: '/v1',
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// openapi31Spec —— OpenAPI 3.1 (`openapi: "3.1.0"`) → accepted as of F-H-1 (has
// servers+operation → candidate).
function openapi31Spec(): string {
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Future API', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// specMissingServers —— valid 3.0 but no `servers` → runtime has no base URL,
// rejected.
function specMissingServers(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'No Servers', version: '1.0.0' },
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// specMissingOperations —— has servers but `paths` is empty → no operation to bind,
// rejected.
function specMissingOperations(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'No Ops', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: {},
  });
}

// oversizedSpec —— valid 3.0 but stuffed with a huge description that pushes the
// size past the cap → must be rejected.
// Uses one oversized string field to inflate the size, avoiding a hand-written
// multi-MB literal.
function oversizedSpec(): string {
  const huge = 'x'.repeat(8 * 1024 * 1024); // ~8 MB padding, well over any sane cap
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Huge API', version: '1.0.0', description: huge },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: { '/freebusy': { post: { operationId: 'freebusy.query', responses: {} } } },
  });
}

// duplicateOperationIdSpec —— two different operations share one operationId → a
// binding can't point to it uniquely, rejected.
function duplicateOperationIdSpec(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Dup Op', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: {
      '/freebusy': { post: { operationId: 'dup.op', responses: { '200': { description: 'ok' } } } },
      '/events': { post: { operationId: 'dup.op', responses: { '200': { description: 'ok' } } } },
    },
  });
}

// specMissingOperationId —— an operation with no operationId (a binding needs it to
// point at) → flagged as missing an anchor.
function specMissingOperationId(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'No OpId', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: { '/freebusy': { post: { responses: { '200': { description: 'ok' } } } } },
  });
}

// specExternalRef —— $ref points at an external file (cannot resolve within this
// document) → rejected/returns a clear result.
function specExternalRef(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'External Ref', version: '1.0.0' },
    servers: [{ url: 'https://api.acme.test/v1' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          requestBody: { content: { 'application/json': { schema: { $ref: './common.yaml#/FreeBusyReq' } } } },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });
}

// specInternalRef —— $ref points within the same document, #/components/...
// (resolvable) → resolves.
function specInternalRef(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Internal Ref Calendar', version: '1.0.0' },
    servers: [{ url: 'https://calendar.acme.test/v1' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/FreeBusyReq' } } } },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: { schemas: { FreeBusyReq: { type: 'object', properties: { timeMin: { type: 'string' } } } } },
  });
}

// validCalendarSpecYaml —— the same semantics as validCalendarSpec, but as YAML text
// (verifies non-JSON goes through the same parse path). Hand-written YAML literal —
// indentation is meaningful, do not reformat.
function validCalendarSpecYaml(): string {
  return [
    'openapi: "3.0.0"',
    'info:',
    '  title: Acme Calendar',
    '  version: "1.0.0"',
    'servers:',
    '  - url: https://calendar.acme.test/v1',
    'paths:',
    '  /freebusy:',
    '    post:',
    '      operationId: freebusy.query',
    '      responses:',
    '        "200":',
    '          description: ok',
    '',
  ].join('\n');
}
