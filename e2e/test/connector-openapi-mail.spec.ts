// connector-openapi-mail.spec.ts -- #155 §8 zone F (consumption closure), filling the
// **missing diagonal**: openapi × mail.
//
// The existing suite covers two diagonals:
//   - openapi × calendar  -> connector-binding-jsonata.spec.ts (SaaS spec + JSONata binding)
//   - protocol × mail      -> connector-protocol-smtp.spec.ts / connector-provider-agnostic.spec.ts (built-in SMTP)
// but **not** openapi × mail -- i.e. a SaaS sending-mail HTTP API (SendGrid/Mailgun/Postmark
// style) plus a JSONata binding that maps MailContract.Send to "POST /mail/send", filling
// the "mail" category slot. This file pins down that diagonal.
//
// Business story: the owner pastes a SendGrid-style OpenAPI 3.0 spec + binding
// (category=mail, mapping the send contract op to operationId=mail.send, auth=apiKey or
// bearer) -> the backend assembles a kind=openapi mail connector -> connect (apiKey, no
// OAuth dance, saving the key connects it) -> the mail.send cap's dependency.connected
// flips true -> the mailer sends via MailContract.Send, **not knowing or caring** whether
// underneath it's an HTTP SaaS or SMTP -> the SaaS mock receives the mail, and the request
// JSONata correctly constructs the contract's {to,subject,text} into that SaaS's send
// body shape.
//
// Aligned with docs/design/connector.md: §1 (mail = SendGrid(openapi) or SMTP(protocol),
// with the contract abstracting kind away) + §2 (one category satisfied by two kinds;
// bindings declare op->contract mappings) + §7 decision #1 (the mapping language is
// JSONata only) + §8 target interface (REST POST /api/admin/connectors {spec,binding};
// .../{id}/{credentials,connect,status,disconnect}; MailContract.Send; direct diag probe).
//
// Covers openapi-mail assembly + JSONata request construction + apiKey connect +
// MailContract via the openapi runtime path (pasting a SaaS HTTP spec + a binding to fill
// the mail slot). Implemented, green (originally a RED contract, went green once built).
//
// Real service: spec.servers points at external-mock's SendGrid mock endpoint (**a new
// endpoint, assumed**, /__mock/sendgrid/*, structured the same as the existing
// /__mock/gcal/*). The backend's openapi runtime really POSTs to /mail/send, the mock
// records the body it received; the error path uses the mock's fault control plane to
// force 5xx/4xx. Never touches real SendGrid.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';
import { clearMailpit, countMailpitMessages } from '@/fixtures/mail';
import { FORM_MAIL_SPEC, FORM_MAIL_BINDING } from '@/fixtures/openapi-mail-specs';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// external-mock's SendGrid-style sending-mail mock control plane (**a new endpoint,
// assumed**, structured the same as /__mock/gcal/*): spec.servers' base plus
// /__mock/sendgrid/{sent,fail,reset} to control/read it.
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
// The control plane (read/armed by e2e over localhost); spec.servers uses the
// service-name (hit from inside the backend container).
const SENDGRID_BASE = `${MOCK}/__mock/sendgrid`;
const SENDGRID_API_BASE = 'http://external-mock:9000/__mock/sendgrid';

const OWNER = {
  email: 'openapi-mail@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'openapimail',
  fullName: 'OpenAPI Mail Owner',
};

// ─── inlined sample OpenAPI 3.0 spec (mail; SendGrid-style; servers → mock) ───
// A minimal but valid 3.0 spec: one operationId (mail.send, POST /mail/send) + one
// apiKey securityScheme (bearer header, matching SendGrid's `Authorization: Bearer
// SG.xxx` shape). servers.url points at the e2e SendGrid mock, so the openapi runtime
// really POSTs to the existing/new /__mock/sendgrid/mail/send, and the mock records the
// body for request-JSONata assertions.
const SENDGRID_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample SendGrid-style Mail', version: '1.0.0' },
  servers: [{ url: SENDGRID_API_BASE }],
  paths: {
    '/mail/send': {
      post: {
        operationId: 'mail.send',
        security: [{ bearer: [] }],
        responses: {
          '202': { description: 'queued' },
          '400': { description: 'invalid recipient' },
          '500': { description: 'provider error' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      // SendGrid uses `Authorization: Bearer SG.<key>` -- http/bearer. The owner fills
      // in one token field (§4 auth table: http bearer -> single token). apiKey (header)
      // works too; both are "save the key and it's connected, no OAuth dance".
      bearer: { type: 'http', scheme: 'bearer' },
    },
  },
} as const;

// ─── inlined sample JSONata binding (mail; Send → POST /mail/send) ───
// category=mail, kind=openapi, mapping the sole contract op `send` to
// operationId=mail.send.
//   send.request : contract input {to,subject,text} -> SaaS send body
//     SendGrid shape: { personalizations:[{ to:[{ email }] }], subject,
//                    content:[{ type:"text/plain", value }] }
//     JSONata builds this nested shape from the contract fields (proving the request
//     direction's construction capability).
//   send.response: SaaS 202 response -> contract SendResult (only message_id needed
//                    here; the mock replies with { message_id } or an X-Message-Id
//                    header, and the binding extracts and normalizes it).
const SENDGRID_BINDING = {
  category: 'mail',
  kind: 'openapi',
  operations: {
    send: {
      op: 'mail.send',
      // request: contract (to,subject,text) → SendGrid send body.
      request:
        '{ "personalizations": [{ "to": [{ "email": to }] }], ' +
        '"subject": subject, ' +
        '"content": [{ "type": "text/plain", "value": body }] }',
      // response: SaaS → contract SendResult {id}.
      response: '{ "id": message_id }',
    },
  },
} as const;

// ─── inlined bad binding (assembly-time check: declares mail but doesn't really send) ───
// category="mail" but the mapped op isn't a send operation (points to a stats-read op,
// added into the spec here). Expected assembly/runtime flag: "declares the mail category
// but its ops don't satisfy MailContract.Send".
const NON_SENDING_SPEC = {
  ...SENDGRID_SPEC,
  paths: {
    '/stats': {
      get: {
        operationId: 'mail.stats',
        security: [{ bearer: [] }],
        responses: { '200': { description: 'stats' } },
      },
    },
  },
} as const;
const NON_SENDING_BINDING = {
  category: 'mail',
  kind: 'openapi',
  operations: {
    // Maps the contract's send op to a **read stats** op -- doesn't send.
    send: { op: 'mail.stats', request: '{ "ignored": to }', response: '{ "id": "noop" }' },
  },
} as const;

// ─── target REST/diag helpers (unbuilt; §8 interface sketch) ───

interface CreateResult { status: number; id?: string; error?: string }
interface ConnStatus { id: string; category: string; kind: string; has_credentials: boolean; connected: boolean }
// One SaaS send the mock recorded (used to assert the body shape the request JSONata built).
interface SentMail {
  // id -- the message id this fake vendor issued for this mail (the receipt carries the same one).
  id: string;
  to: string[];
  subject: string;
  text: string;
  // raw -- the SaaS body the mock saved verbatim (used to assert the nested construction,
  // e.g. personalizations/content).
  raw: SendGridBody;
}
interface SendGridBody {
  personalizations?: { to?: { email?: string }[] }[];
  subject?: string;
  content?: { type?: string; value?: string }[];
}
// Directly verifies the mailer's MailContract.Send result via diag (bypasses the
// visitor session, asserting the shape cleanly).
interface MailSendDiag {
  status: number; ok: boolean; via_kind?: string; reason?: string;
  // message_id -- the id the provider handed back. **The product used to read none of it** (F-C-55).
  message_id?: string;
}

// POST /api/admin/connectors -- builds an openapi connector from spec+binding. 201 → {id}; 4xx → {error}.
async function createConnector(
  request: APIRequestContext, csrf: string,
  body: { spec: unknown; binding: unknown },
): Promise<CreateResult> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
    data: body,
  });
  const json = await res.json().catch(() => ({})) as { id?: string; error?: string };
  return { status: res.status(), id: json.id, error: json.error };
}

// connectApiKey -- saves the bearer/apiKey secret (form derived from the spec) + connects.
// apiKey has no OAuth dance: connect returns {connected:true} directly (§4 "apiKey/basic/bearer/smtp
// -> directly Connected").
async function connectApiKey(
  request: APIRequestContext, csrf: string, id: string,
): Promise<ConnStatus> {
  const credRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/credentials`,
    { headers: { 'X-Csrftoken': csrf }, data: { token: 'SG.e2e-fake-key' } },
  );
  if (credRes.status() !== 200) throw new Error(`mail credentials: ${credRes.status()}`);
  const connectRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/connect`,
    { headers: { 'X-Csrftoken': csrf }, data: {} },
  );
  if (connectRes.status() !== 200) throw new Error(`mail connect: ${connectRes.status()}`);
  const stRes = await request.get(`${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/status`);
  if (stRes.status() !== 200) throw new Error(`mail status: ${stRes.status()}`);
  return await stRes.json() as ConnStatus;
}

async function disconnectConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/disconnect`,
    { headers: { 'X-Csrftoken': csrf }, data: {} },
  );
  if (res.status() !== 200) throw new Error(`disconnect ${id}: ${res.status()}`);
}

// diagSend -- sends a test mail through the button the owner **actually clicks**: the
// panel's "send a test mail".
//
// This used to go through diag's generic invoke endpoint. That endpoint is an
// owner-authed diagnostic back door, deliberately surfacing the **raw underlying
// reason** ("why doesn't my binding work" is its entire reason for existing). So the
// test cases asserting "the message is friendly, doesn't leak a status code" were
// measuring diag's wording, not the product's -- and the product's actual message was
// never tested at all.
//
// After switching to the real endpoint, they measure what the owner actually sees:
// the categorized message plus via_kind.
async function diagSend(
  request: APIRequestContext, csrf: string, _id: string,
  mail: { to: string; subject: string; text: string },
): Promise<MailSendDiag> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/ops/mail_test_send`, {
    headers: { 'X-Csrftoken': csrf },
    data: { to: mail.to, subject: mail.subject, text: mail.text },
  });
  const json = await res.json().catch(() => ({})) as
    { ok?: boolean; via_kind?: string; reason?: string; message_id?: string };
  return {
    status: res.status(), ok: json.ok ?? false,
    via_kind: json.via_kind, reason: json.reason, message_id: json.message_id,
  };
}

// ─── SendGrid mock control plane (assumed new; /__mock/sendgrid/*) ───

// getSentMail -- reads every send the mock recorded (asserts the booker/mailer really
// hit it, plus the body shape).
async function getSentMail(request: APIRequestContext): Promise<SentMail[]> {
  const res = await request.get(`${SENDGRID_BASE}/sent`);
  if (res.status() !== 200) throw new Error(`sendgrid sent: ${res.status()}`);
  return (await res.json() as { sent: SentMail[] }).sent;
}

// failNextSend -- makes the mock's next /mail/send call return the given status (5xx
// degrade / 4xx reject).
async function failNextSend(request: APIRequestContext, status: number): Promise<void> {
  const res = await request.post(`${SENDGRID_BASE}/fail`, { data: { status, times: 1 } });
  if (res.status() !== 200) throw new Error(`sendgrid fail arm: ${res.status()}`);
}

async function resetSendGridMock(request: APIRequestContext): Promise<void> {
  await request.post(`${SENDGRID_BASE}/reset`, { data: {} }).catch(() => undefined);
}

// assembleAndConnectMail -- assembles one openapi mail connector (SendGrid spec+binding)
// and connects it. Returns status; idempotency relies on each test resetting the
// instance itself (not shared across tests here).
async function assembleAndConnectMail(
  request: APIRequestContext, csrf: string,
): Promise<ConnStatus> {
  const r = await createConnector(request, csrf, {
    spec: SENDGRID_SPEC, binding: SENDGRID_BINDING,
  });
  expect(r.status, r.error ?? '').toBe(201);
  expect(r.id).toBeTruthy();
  return connectApiKey(request, csrf, r.id!);
}

async function initOwner(playwright: Playwright): Promise<{
  request: APIRequestContext; csrf: string;
}> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await resetSendGridMock(request);
  return { request, csrf };
}

// ─── test bodies (extracted; the describe stays a thin wrapper) ───

// runHappyMainline -- the whole diagonal's mainline: assemble -> connect(apiKey) ->
// mail.send gate opens -> MailContract.Send via the openapi runtime -> SaaS mock receives it.
async function runHappyMainline(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  expect(st.kind, 'kind=openapi (not protocol)').toBe('openapi');
  expect(st.category).toBe('mail');
  expect(st.connected, 'apiKey connects on saving the key, no OAuth dance').toBe(true);

  // dep-gating: the mail category slot is now connected -> the mail.send cap gate opens.
  const cap = await findCapability(request, csrf, 'mail.send');
  expect(cap?.dependency?.connected, 'openapi mail connected → mail category slot connected').toBe(true);

  // The mailer sends via MailContract.Send, not knowing it's an HTTP SaaS underneath.
  const sent = await diagSend(request, csrf, st.id, {
    to: 'recruiter@corp.test', subject: 'OpenAPI mail', text: 'hello from SendGrid-style API',
  });
  expect(sent.status).toBe(200);
  expect(sent.ok, 'MailContract.Send succeeds via the openapi runtime').toBe(true);
  expect(sent.via_kind, 'mailer neither knows nor cares it is openapi underneath').toMatch(/openapi|http/i);

  // The SaaS mock really receives the mail.
  const inbox = await getSentMail(request);
  expect(inbox, 'SendGrid mock received the mail the mailer sent').toHaveLength(1);
  expect(inbox[0]!.to).toContain('recruiter@corp.test');
  expect(inbox[0]!.subject).toBe('OpenAPI mail');
}

// runReceiptCarriesID -- sends one mail, asserts the receipt's id is exactly the one
// this fake vendor issued for it.
async function runReceiptCarriesID(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  const sent = await diagSend(request, csrf, st.id, {
    to: 'recruiter@corp.test', subject: 'receipt carries id', text: 'who sent what',
  });
  expect(sent.ok, 'precondition: the send itself goes through').toBe(true);

  const inbox = await getSentMail(request);
  expect(inbox, 'precondition: the vendor recorded exactly this one send').toHaveLength(1);
  expect(
    sent.message_id,
    'the receipt must carry the id the provider issued, not nothing and not something invented',
  ).toBe(inbox[0]!.id);
}

// runFormEncodedSend -- assembles a connector that declares form-encoding, sends one
// mail, and asserts it **really went out**. The receipt doesn't take the product's own
// word for it: count messages in Mailpit instead (the fake vendor forwards it over SMTP
// once it accepts it).
async function runFormEncodedSend(request: APIRequestContext, csrf: string): Promise<void> {
  await clearMailpit(request);
  const r = await createConnector(request, csrf, {
    spec: FORM_MAIL_SPEC, binding: FORM_MAIL_BINDING,
  });
  expect(r.status, r.error ?? '').toBe(201);
  const st = await connectApiKey(request, csrf, r.id!);
  expect(st.connected, 'precondition: the key saves and the connector connects').toBe(true);

  const sent = await diagSend(request, csrf, st.id, {
    to: 'recruiter@corp.test', subject: 'form encoded', text: 'sent as a form, not as JSON',
  });
  expect(
    sent.ok,
    'the vendor declares a form-encoded body — sending JSON gets "from parameter is missing"',
  ).toBe(true);

  await expect.poll(
    async () => countMailpitMessages(request), { timeout: 15_000 },
  ).toBeGreaterThan(0);
}

// runRequestConstruct -- asserts the raw body the mock recorded is the SendGrid nested
// shape (personalizations/content), proving the request-direction JSONata construction
// capability.
async function runRequestConstruct(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  const sent = await diagSend(request, csrf, st.id, {
    to: 'rachel@example.com', subject: 'Intro chat', text: 'Looking forward to it.',
  });
  expect(sent.ok).toBe(true);

  const inbox = await getSentMail(request);
  const ev = inbox.find((m) => m.subject === 'Intro chat');
  expect(ev, 'mock recorded the constructed send').toBeTruthy();
  // Check every field of the SendGrid nested shape the request JSONata built.
  const body = ev!.raw;
  expect(body.personalizations?.[0]?.to?.[0]?.email, 'to → personalizations[0].to[0].email')
    .toBe('rachel@example.com');
  expect(body.subject, 'subject mapped through directly').toBe('Intro chat');
  expect(body.content?.[0]?.type, 'text → content[0].type=text/plain').toBe('text/plain');
  expect(body.content?.[0]?.value, 'text → content[0].value').toBe('Looking forward to it.');
}

// runDegrade -- the SaaS send returns a given status (5xx or 4xx) -> friendly degrade:
// no crash, no leaked stack, reason matches the friendly pattern, the mock never
// received the mail. Shared by 5xx/4xx; msgPattern tells the wording apart.
async function runDegrade(
  request: APIRequestContext, csrf: string,
  failStatus: number, mail: { to: string; subject: string; text: string }, msgPattern: RegExp,
): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  await failNextSend(request, failStatus);

  const sent = await diagSend(request, csrf, st.id, mail);
  expect(sent.status, 'a provider error must not crash us into a 5xx too').toBeLessThan(500);
  expect(sent.ok, 'provider error → not successful').toBe(false);
  const msg = sent.reason ?? '';
  expect(msg, 'friendly message').toMatch(msgPattern);
  expect(msg, 'does not leak the provider raw error/stack/status code').not.toMatch(/panic|goroutine|stack|\d{3}/i);
  expect(await getSentMail(request), 'degraded/rejected → mock did not deliver successfully').toHaveLength(0);
}

// runNonSendingFlagged -- the binding declares category="mail" but its mapped op
// doesn't really send. Ideal: rejected at assembly time; fallback: MailContract.Send
// fails at runtime -- either path is accepted.
async function runNonSendingFlagged(request: APIRequestContext, csrf: string): Promise<void> {
  const r = await createConnector(request, csrf, {
    spec: NON_SENDING_SPEC, binding: NON_SENDING_BINDING,
  });
  if (r.status >= 400 && r.status < 500) {
    // Ideal: rejected at assembly time.
    expect(r.error ?? '').toMatch(/mail|send|contract|operation|category/i);
    expect(r.id, 'connector not created').toBeFalsy();
    return;
  }
  // Fallback: assembly went through, but MailContract.Send must fail at runtime (nothing really sent).
  expect(r.status, r.error ?? '').toBe(201);
  const st = await connectApiKey(request, csrf, r.id!);
  const sent = await diagSend(request, csrf, st.id, {
    to: 'recruiter@corp.test', subject: 'no-op', text: 'this op does not send',
  });
  expect(sent.ok, 'mapped to a non-send op → Send unsuccessful').toBe(false);
  expect(await getSentMail(request), 'non-send op → mock received no mail').toHaveLength(0);
}

// runDepGating -- disconnect the openapi mail connector -> mail.send re-gates.
async function runDepGating(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  const before = await findCapability(request, csrf, 'mail.send');
  expect(before?.dependency?.connected, 'connected → mail slot connected').toBe(true);

  await disconnectConnector(request, csrf, st.id);
  const after = await findCapability(request, csrf, 'mail.send');
  expect(after?.dependency?.connected, 'disconnected → mail slot disconnected → mail.send re-gated').toBe(false);
}

test.describe('connector · openapi mail (SendGrid-style, kind=openapi fills the mail slot, §8 area F diagonal)', () => {
  // #155 §8-F is implemented: the openapi × mail diagonal (SaaS sending HTTP spec +
  // JSONata binding filling the mail slot + apiKey connect + MailContract via the
  // openapi runtime -> SendGrid-style mock).

  let request: APIRequestContext;
  let csrf: string;

  // Reset the instance + owner + SendGrid mock per test (connectors don't accumulate
  // across tests; dep-gating asserts absolute state, which needs to be clean).
  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  // happy: assemble an openapi mail connector -> connect(apiKey) -> mail.send cap gate
  // opens -> MailContract sends through it -> mock receives it.
  test('assemble openapi mail connector → connect (apiKey, no dance) → mail.send un-gates → MailContract.Send goes through it → mock received',
    async () => { await runHappyMainline(request, csrf); });

  // happy: request JSONata correctly constructs the contract's {to,subject,text} into
  // the SaaS send body shape.
  test('request JSONata constructs the SaaS send body shape from {to, subject, text}',
    async () => { await runRequestConstruct(request, csrf); });

  // err: connected but the SaaS send returns 5xx -> friendly degrade (no crash, no
  // leaked stack, nothing recorded).
  test('connected but the SaaS send returns 5xx → friendly degrade (no crash, no stack, no send recorded)',
    async () => {
      await runDegrade(
        request, csrf, 500,
        { to: 'recruiter@corp.test', subject: '5xx degrade', text: 'should fail gracefully' },
        /again|later|unavailable|mail|couldn'?t|deliver/i,
      );
    });

  // err: the SaaS send returns 4xx (e.g. invalid recipient) -> also friendly, no
  // leaking the underlying error.
  test('a 4xx from the SaaS (e.g. invalid recipient rejected) → friendly (no raw provider error)',
    async () => {
      await runDegrade(
        request, csrf, 400,
        { to: 'not-an-email', subject: '4xx reject', text: 'bad recipient' },
        /recipient|address|invalid|mail|couldn'?t|deliver/i,
      );
    });

  // err: the binding declares category="mail" but the spec/ops don't actually send ->
  // flagged at assembly time (or runtime).
  test('a mail binding whose spec/ops do not actually send is flagged (at assemble or runtime)',
    async () => { await runNonSendingFlagged(request, csrf); });

  // F-C-54 -- **the spec says the body is form-encoded; at runtime, JSON is sent anyway.**
  //
  // Hit in a real environment (real Mailgun account + real sending key): sent as the
  // multipart it wanted -> 200 + `{"id":"<...@sandbox....mailgun.org>"}`, Gmail really
  // received it. Same endpoint, same key, switch the body to `application/json` ->
  // **400 `{"message":"from parameter is missing"}`** -- it simply never saw those
  // fields. The product **only ever sends JSON** (hardcoded in `runtime.go:174` /
  // `runtime_raw.go:51`), and the media type declared in the spec
  // (`spec.go:187` only reads `application/json`) was never looked at.
  //
  // This isn't a corner case: Mailgun / Twilio / Stripe's send-mail, send-SMS, and
  // payment endpoints are all form-encoded. Every one of the mock's fake vendors used
  // to speak only JSON, so this whole class of behavior didn't exist in the test suite
  // ([[stand-in-is-politer-than-reality]]).
  //
  // The criterion can fail: **it uses the exact same assembly, the same key, the same
  // contract as the happy test above**, the only difference being the spec declares
  // `application/x-www-form-urlencoded` and the endpoint only accepts forms. Red can
  // only mean one thing: the declared media type wasn't honored.
  test('a spec that declares a form-encoded body is actually sent as a form (F-C-54)',
    async () => { await runFormEncodedSend(request, csrf); });

  // F-C-55 -- **the message id the provider hands back is read by nothing in the product.**
  //
  // Seen while driving mail-connector check 5: that field wants "the message id read
  // from wherever the provider actually puts it". But `contract.MailProxy.Send`'s
  // signature is `... error` -- **there's nowhere to hold an id**; `mailAdapter.Send`
  // calls `runtime.Call(ctx, "send", in, nil, inj)`, and the output arg is just `nil`.
  // So every mail binding's `response: '{ "id": ... }'` gets evaluated and thrown away.
  //
  // The consequence isn't "read from the wrong place", it's that **the send receipt
  // amounts to nothing more than "no error"**: the id the provider gives back is the
  // only handle you have afterward (to find this mail in its logs, match a bounce, tell
  // the owner which mail actually went out), and it's dropped. Same class as
  // [[write-with-no-receipt]] / [[nonunique-signal-not-a-receipt]].
  //
  // The criterion can fail: it doesn't just assert "non-empty" (a hardcoded string
  // would pass that); it asserts **it equals the id this fake vendor issued for this
  // exact mail** -- a value that can only have come from the response.
  test('the provider message id comes back on the receipt (F-C-55)',
    async () => { await runReceiptCarriesID(request, csrf); });

  // dep-gating: disconnect the openapi mail connector -> mail.send re-gates. Implemented,
  // via "mail as a visitor capability".
  test('disconnect the openapi mail connector → mail.send re-gates',
    async () => { await runDepGating(request, csrf); });
});

// This file used to have an inline diagInvoke -- hitting the owner-authed connector
// diagnostic endpoint, bypassing the real path. It's gone: these test cases ask "what
// does the owner see after clicking send a test mail", and that's the panel's button,
// not the diagnostic endpoint. The diagnostic endpoint deliberately surfaces the raw
// underlying reason, so measuring "is the message friendly enough" against it measures
// something else entirely.
