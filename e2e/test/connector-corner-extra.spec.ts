// connector-corner-extra.spec.ts — closing out #155's corner/error-stream cases (a few items
// outside design §1-9, but genuinely part of the boundary/error-stream space, added after
// auditing design-vs-test). Implemented, green (originally a RED contract, turned green after
// the implementation landed).
//
//   - 429 throttling (error stream): connector connected, a runtime SaaS call comes back 429 →
//     friendly degradation/backoff, no crash, no leak, no garbage returned (same family as the
//     existing 5xx/4xx degradation, differing only in 429's semantics — throttling can back off).
//   - editing an already-built connector's spec → the credential form **re-derives** (changing
//     the auth type changes the form along with it).
//   - two calendar connectors of **the same kind (openapi)** → the same §1/§9 slot rule (exactly
//     one active), filling the gap that kind-coexist only tested cross-kind (openapi+protocol).
//
// Driven through the API/diag surface (the same gold shape as connector-provider-agnostic /
// connector-binding-jsonata). The interface tracks connector.md §8's calibration plus §9:
// POST /api/admin/connectors {spec,binding}, …/{id}/{credentials,connect,status,activate},
// PUT …/{id} (edit), diag POST /internal/diag/connector/{id}/list-busy, and the
// mock /__mock/gcal/* control plane.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK = process.env['JOB_BOARD_MOCK_URL'] ?? 'http://localhost:9000';

const OWNER = {
  email: 'corner-extra@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cornerowner',
  fullName: 'Corner Extra Owner',
};

// An openapi calendar spec + binding pointed at the gcal mock (freebusy/events.insert). servers
// uses a service-name (the backend container hits the gcal API and triggers the fail injection
// from inside the container); /__mock/gcal/* control-plane calls go through localhost.
const CAL_SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Cal', version: '1' },
  servers: [{ url: 'http://external-mock:9000/google-calendar' }],
  paths: {
    '/freeBusy': { post: { operationId: 'freebusy.query', responses: { '200': { description: 'ok' } } } },
    '/events': { post: { operationId: 'events.insert', responses: { '200': { description: 'ok' } } } },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
});
// Standard binding format: request/response are JSONata strings (consistent with the
// binding-jsonata contract).
const CAL_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: { op: 'freebusy.query', request: '{}', response: '{ "busy": calendars.primary.busy }' },
    create_event: { op: 'events.insert', request: '{ "summary": summary }', response: '{ "id": id }' },
  },
};
// The second spec differs in content (a different title) but is still openapi calendar — used to
// test coexistence of the same kind.
const CAL_SPEC_2 = CAL_SPEC.replace('"Cal"', '"Cal Two"');

test.describe('connector · extra corner / error stream (wrap-up)', () => {
  // 429 degradation + same-kind coexistence are already landed. spec-edit re-derivation
  // (the PUT + credential-form derivation side) belongs to #161's generic admin-route
  // credential-form derivation, tracked separately and pending, fixme per case.

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => { request = await initOwner(playwright); });
  test.afterAll(async () => { await request.dispose(); });

  // 429 throttling → friendly degradation (no crash, no leak, no garbage returned).
  test('429 throttling: runtime SaaS call returns 429 → friendly degrade (no 5xx/stack, no garbage)', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);
    await armMockStatus(request, 'freeBusy', 429);

    const { status, body } = await diagListBusy(request, csrf, id);
    expect(status, 'a 429 must not crash us').toBeLessThan(500);
    const msg = JSON.stringify(body);
    expect(msg, 'friendly throttle hint, back off / try later').toMatch(/again|later|rate|busy|limit|unavailable/i);
    expect(msg, 'does not leak the provider raw error/stack/status code').not.toMatch(/panic|goroutine|stack|429/);
  });

  // Editing an already-built connector's spec (changing the auth type) → the credential
  // form/status re-derives (#161 PUT /{id} + credential-form).
  test('edit spec → credential form re-derives (bearer → apiKey changes the fields)', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);

    // The same spec, changed to apiKey auth.
    const apiKeySpec = CAL_SPEC.replace(
      '{"bearer":{"type":"http","scheme":"bearer"}}',
      '{"apiKey":{"type":"apiKey","in":"header","name":"X-Api-Key"}}',
    );
    const res = await request.put(`${BACKEND}/api/admin/connectors/${id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(apiKeySpec), binding: CAL_BINDING },
    });
    expect(res.status(), 'PUT edit spec → 200').toBe(200);

    // The re-derived credential form/requirements reflect apiKey (no more oauth dance).
    const form = await request.get(`${BACKEND}/api/admin/connectors/${id}/credential-form`);
    const f = await form.json() as { auth_type?: string; fields?: { key: string }[] };
    expect(f.auth_type, 're-derived → apiKey').toMatch(/api.?key/i);
    expect((f.fields ?? []).map((x) => x.key), 'apiKey field, no longer client_id').toContain('key');
  });

  // Two same-kind (openapi) calendar connectors → exactly one active (the §1/§9 slot rule, not
  // limited to cross-kind).
  test('two same-kind (openapi) calendars → exactly one active, slot rule same as cross-kind', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const a = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);
    const b = await assembleOpenapiCalendar(request, csrf, CAL_SPEC_2, CAL_BINDING);
    expect(b, 'two distinct openapi calendar connectors').not.toBe(a);

    // Both are connected, but the category slot allows exactly one active.
    const rows = await listConnectors(request);
    const cals = rows.filter((c) => c.category === 'calendar');
    expect(cals.length, 'two connectors of the same category coexist').toBeGreaterThanOrEqual(2);
    expect(cals.filter((c) => c.active).length, 'exactly one active').toBe(1);

    // Explicitly activating the other one → the slot hands over.
    await request.post(`${BACKEND}/api/admin/connectors/${b}/activate`, { headers: { 'X-Csrftoken': csrf }, data: {} });
    const after = (await listConnectors(request)).filter((c) => c.category === 'calendar');
    expect(after.find((c) => c.id === b)?.active, 'after activate, b becomes active').toBe(true);
    expect(after.find((c) => c.id === a)?.active, 'a falls back to inactive').toBe(false);

    // dep-gating stays open (at least one active connector is connected).
    const cap = await findCapability(request, csrf, 'calendar.book');
    expect(cap?.dependency?.connected, 'an active connected exists → still un-gated').toBe(true);
  });
});

// credform derivation-drift guards: the configure form (credform) used to enumerate its own copy
// of auth knowledge separately from the ingest preview (authform)/the injector, and the two
// drifted apart. After consolidating to a single authform source, these two cases pin down the
// two drifts that had occurred (the apiKey field name, and oidc being treated as a bare token).
test.describe('connector · credential-form derivation drift guards (area B)', () => {
  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => { request = await initOwner(playwright); });
  test.afterAll(async () => { await request.dispose(); });

  // A custom-named apiKey scheme (e.g. "sendgrid"): the storage field is always "key" — the
  // injector literally reads creds["key"] (hardcoded json:"key"). If the form derived the field
  // name from the scheme name ("sendgrid") instead, the owner would fill in the wrong field →
  // an empty key gets injected → a silent 401.
  test('named apiKey scheme → credential field stays "key", never the scheme name', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);

    const namedSpec = CAL_SPEC.replace(
      '{"bearer":{"type":"http","scheme":"bearer"}}',
      '{"sendgrid":{"type":"apiKey","in":"header","name":"X-Custom-Key"}}',
    );
    const res = await request.put(`${BACKEND}/api/admin/connectors/${id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(namedSpec), binding: CAL_BINDING },
    });
    expect(res.status(), 'PUT named-apiKey spec → 200').toBe(200);

    const form = await request.get(`${BACKEND}/api/admin/connectors/${id}/credential-form`);
    const f = await form.json() as { fields?: { key: string }[] };
    const keys = (f.fields ?? []).map((x) => x.key);
    expect(keys, 'storage field is "key" (matches the injector), not the scheme name').toContain('key');
    expect(keys, 'never keyed by the scheme name "sendgrid"').not.toContain('sendgrid');
  });

  // openIdConnect scheme: credform used to have no openIdConnect branch → it fell through to the
  // "token" default (wrong — oidc is oauth: client_id/secret plus the dance). After
  // consolidating to a single authform source, this should now produce oauth fields.
  test('openIdConnect scheme → credential form is oauth (client_id/secret), not a bare token', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);

    const oidcSpec = CAL_SPEC.replace(
      '{"bearer":{"type":"http","scheme":"bearer"}}',
      '{"oidc":{"type":"openIdConnect","openIdConnectUrl":"https://issuer.example.com/.well-known/openid-configuration"}}',
    );
    const res = await request.put(`${BACKEND}/api/admin/connectors/${id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(oidcSpec), binding: CAL_BINDING },
    });
    expect(res.status(), 'PUT oidc spec → 200').toBe(200);

    const form = await request.get(`${BACKEND}/api/admin/connectors/${id}/credential-form`);
    const f = await form.json() as { fields?: { key: string }[] };
    const keys = (f.fields ?? []).map((x) => x.key);
    expect(keys, 'oidc asks for the oauth client creds').toContain('client_id');
    expect(keys, 'oidc is oauth, not a bare token field').not.toContain('token');
  });
});

// ─── helpers (inline; promote to fixtures/connector-corner.ts once the implementation goes green) ───

interface ConnRow { id: string; category: string; kind: string; active: boolean; connected: boolean }

async function initOwner(playwright: Playwright): Promise<APIRequestContext> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await login(request, OWNER.email, OWNER.password);
  return request;
}

// assembleOpenapiCalendar — creates an openapi calendar connector, saves bearer credentials, and
// connects it. Returns the id.
async function assembleOpenapiCalendar(
  request: APIRequestContext, csrf: string, spec: string, binding: unknown,
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: { spec: JSON.parse(spec), binding },
  });
  if (res.status() !== 201) throw new Error(`create connector: ${res.status()}`);
  const id = (await res.json() as { id: string }).id;
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { token: 'test-bearer-token' },
  });
  await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  return id;
}

async function listConnectors(request: APIRequestContext): Promise<ConnRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  return (await res.json() as { connectors?: ConnRow[] }).connectors ?? [];
}

// armMockStatus — makes the gcal mock keep returning a given HTTP status for some op (429
// throttling etc.; times:-1 = indefinitely, exhausting the retry budget → friendly degradation).
async function armMockStatus(request: APIRequestContext, op: string, status: number): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, { data: { op, status, times: -1 } });
}

// diagListBusy — hits the runtime directly (bypassing the LLM), for a clean assertion on the
// degradation shape.
async function diagListBusy(
  request: APIRequestContext, csrf: string, id: string,
): Promise<{ status: number; body: unknown }> {
  const r = await diagInvoke(request, csrf, id, 'calendar', 'free_busy',
    { time_min: '2030-01-01T00:00:00Z', time_max: '2030-01-02T00:00:00Z' });
  return { status: r.status, body: JSON.parse(r.text || '{}') as unknown };
}

// diagInvoke — hits the owner-authed connector diag endpoint. **This is a backdoor that bypasses
// the real call chain** (the real path is visitor chat → agent → booker sandbox →
// connector.invoke), so it's **deliberately** kept inline here instead of promoted to a shared
// fixture: promoting it would license the bypass, making it that much easier for the next person
// to reach for it. Whether this backdoor itself should stay or go is tracked in the "diag
// backdoor" task.
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
