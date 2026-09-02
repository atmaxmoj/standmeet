// visitor-mcp.spec.ts -- **someone holding a code can ask through their own AI client.**
//
// The owner has long had an MCP surface (`/mcp`, Sigv1); outward-facing, though, there
// was only the web chat and an API key for programs. A recruiter scans a code with
// Claude Desktop already open -- before this surface existed, their only option was
// to go chat on the web.
//
// This isn't asserting "the MCP protocol works", it's asserting **that this is just
// another rendering of the same code**: the same grant, the same quota, the same
// accounting. So every test case here asks "what would give this a license to behave
// differently from the other surfaces", and the answer must always be nothing.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MCP = `${BACKEND}/mcp/visitor`;

const OWNER = {
  email: 'visitor-mcp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'vmcp',
  fullName: 'Visitor MCP Owner',
};

interface RPCResult { status: number; body: Record<string, unknown> }

// rpc -- **follows the real client's path**: initialize first to get a session id,
// then send the actual question.
//
// The first version skipped the handshake and sent tools/list directly, and got back
// `Invalid session ID` -- that's a step the streamable HTTP protocol itself requires,
// not the product being broken. Skip it, and the test stops walking the path any real
// client would actually take.
async function rpc(
  request: APIRequestContext, code: string, method: string,
  params: Record<string, unknown> = {}, name?: string,
): Promise<RPCResult> {
  const opened = await initialize(request, code, name);
  if (opened.sid === '') return opened.first;
  const res = await request.post(MCP, {
    headers: mcpHeaders(code, name, opened.sid),
    data: { jsonrpc: '2.0', id: 2, method, params },
  });
  return { status: res.status(), body: parseRPC(await res.text()) };
}

function mcpHeaders(code: string, name: string | undefined, sid: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${code}`,
    ...(name === undefined ? {} : { 'X-Standmeet-Visitor': name }),
    ...(sid === '' ? {} : { 'Mcp-Session-Id': sid }),
  };
}

// initialize -- the handshake. **This is exactly where admission happens**: a wrong
// code / a revoked code / a full quota all get blocked right here, so when no sid
// comes back, hand this response back verbatim as the verdict.
async function initialize(
  request: APIRequestContext, code: string, name?: string,
): Promise<{ sid: string; first: RPCResult }> {
  const res = await request.post(MCP, {
    headers: mcpHeaders(code, name, ''),
    data: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e', version: '0.0.0' },
      },
    },
  });
  const first = { status: res.status(), body: parseRPC(await res.text()) };
  return { sid: res.headers()['mcp-session-id'] ?? '', first };
}

// rpcNoAuth -- one call made **with no code at all**. The first gate on this surface
// is the code itself, so "carrying nothing" is one case that must be driven.
async function rpcNoAuth(
  request: APIRequestContext, method: string,
): Promise<RPCResult> {
  const res = await request.post(MCP, {
    headers: { 'Content-Type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method, params: {} },
  });
  return { status: res.status(), body: parseRPC(await res.text()) };
}

// rpcNoAuthRaw -- sends one request with no credentials, **handing back the raw
// response**: what this test needs to assert is a response header, and the helper
// above only hands back the body.
async function rpcNoAuthRaw(request: APIRequestContext) {
  return request.post(MCP, {
    headers: { 'Content-Type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
}

// parseRPC -- streamable HTTP might reply as an SSE frame, or might reply as plain
// JSON. Both must be readable, or "the protocol shape didn't match" gets misread as
// "the product is broken".
function parseRPC(text: string): Record<string, unknown> {
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  const raw = line === undefined ? text : line.slice('data:'.length);
  try {
    return JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

// refusalOf -- **the message meant for a human** inside one refusal.
//
// Refusals now go through a JSON-RPC error (HTTP 200), because 401 means "go do OAuth"
// in MCP's own vocabulary, and clients render the error object, not the status code
// (F-P-8). So the assertion has to move to that same layer -- every refusal test case
// in this family pulls its wording from here.
function refusalOf(res: RPCResult): string {
  const err = res.body['error'] as { message?: unknown } | undefined;
  return typeof err?.message === 'string' ? err.message : '';
}

// grantedOK -- this call **succeeded**: a result came back, and there's no error.
// Asserting HTTP 200 alone isn't enough any more -- a refusal is also 200 now.
function grantedOK(res: RPCResult): boolean {
  return res.body['result'] !== undefined && res.body['error'] === undefined;
}

function toolNames(body: Record<string, unknown>): string[] {
  const result = body['result'] as { tools?: { name: string }[] } | undefined;
  return (result?.tools ?? []).map((t) => t.name);
}

// OUTWARD -- the set of tools facing outward. **Every name the live endpoint reports
// must be in this set.** The owner surface and the visitor surface live in the same
// process, differing only by a mount-point prefix; let one owner tool leak into this
// list, and a visitor's AI gets it handed straight over.
const OUTWARD = [
  'corpus_search', 'corpus_read', 'corpus_list', 'corpus_links',
  'calendar_list_slots', 'calendar_book',
];

// expectAllOutward -- a ratchet that reads its list from the same list on both sides
// can't prove "this surface is actually wired correctly"; only asking the live
// endpoint can tell "the right set is mounted" apart from "a different set is mounted /
// the filter is too aggressive".
function expectAllOutward(names: string[]): void {
  for (const n of names) {
    expect(OUTWARD, `the live face advertises "${n}", which is not an outward tool`)
      .toContain(n);
  }
}

interface Admin { request: APIRequestContext; csrf: string }

async function freshOwner(playwright: Playwright): Promise<Admin> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

test.describe('a visitor can point their own AI client at this instance', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a code opens the MCP face, and it lists the tools that code grants', async () => {
    const code = await createCode(admin.request, admin.csrf,
      { code: 'MCPV-001', label: 'OWN CLIENT' });
    expect(code.code).toBe('MCPV-001');

    const listed = await rpc(admin.request, 'MCPV-001', 'tools/list');
    expect(grantedOK(listed), JSON.stringify(listed.body)).toBe(true);
    const names = toolNames(listed.body);
    // Asserts **there are tools**, not "no error was returned": an empty list is
    // perfectly valid at the protocol level, and to a visitor's AI it's equivalent to
    // the instance offering nothing at all ([[assertion-that-cannot-fail]]).
    expect(names.length, 'the code grants something to work with').toBeGreaterThan(0);

    expectAllOutward(names);
  });

  // F-P-8 -- a refusal must answer on **the layer the other side is actually listening
  // on**.
  //
  // This test used to assert 401 + `WWW-Authenticate`. The header was written correctly
  // per RFC 6750, but in MCP 401 **means** "go do OAuth", so the official Inspector
  // turned around and ran the discovery flow instead, landing on
  // `Interactive OAuth requires a TTY` -- our "bring your access code" sentence never
  // showed up anywhere.
  //
  // So the assertion now targets the JSON-RPC error object -- exactly what the client
  // renders.
  test('a refusal comes back as a JSON-RPC error, which is what a client renders',
    async () => {
      const res = await rpcNoAuthRaw(admin.request);
      const body = parseRPC(await res.text());
      const err = body['error'] as { message?: unknown; data?: { http_status?: number } };
      expect(typeof err?.message === 'string' ? err.message : '',
        'the sentence must be where the client will render it').toMatch(/access code/i);
      // The kind must also survive: 401 means the credential is wrong, 429 means a
      // gate blocked it, and the next step is different for each person.
      expect(err?.data?.http_status, 'the kind of refusal survives the move').toBe(401);
    });

  // **The id must be echoed back.** A client that pairs responses by id, given
  // `id:null`, treats it as a non-match and waits forever -- a call that never returns
  // is far worse than an ugly error message.
  test('a refusal echoes the request id, so the client can match it', async () => {
    const res = await rpcNoAuthRaw(admin.request);
    expect(parseRPC(await res.text())['id'], 'the client pairs on this').toBe(1);
  });

  test('no code at all is refused, and says how to present one', async () => {
    const bare = await rpcNoAuth(admin.request, 'tools/list');
    // A refusal must say what to do next -- returning just a status code leaves the
    // client on the other end not knowing what credential to bring.
    expect(refusalOf(bare), 'it names the credential to bring').toMatch(/access code/i);
  });

  test('a code that does not exist is refused in the same words as everywhere else',
    async () => {
      const res = await rpc(admin.request, 'NOPE-999', 'tools/list');
      // Asserts **the exact message**, not "there was a response". The same refusal
      // table (visitorErrCases) means someone who mistyped their code reads the exact
      // same sentence on this surface as they would on the web -- and that sentence
      // points to the next step (paste it again), not a status code.
      expect(refusalOf(res),
        'the same words the web path uses for a typo').toMatch(/no such access code/i);
    });

  test('a revoked code stops working on this face too', async () => {
    const code = await createCode(admin.request, admin.csrf,
      { code: 'MCPV-REV', label: 'REVOKED' });
    // Prove it works **before** revoking it -- without this, a red result after
    // revocation might have been red all along, for a different reason.
    expect(grantedOK(await rpc(admin.request, 'MCPV-REV', 'tools/list')),
      'it works before the revoke').toBe(true);

    await revokeCode(admin.request, admin.csrf, code.id);

    // **A revocation must mean revoked.** Without this test, the owner thinks the
    // grant was withdrawn, while that client is still connected. Asserting the
    // message, not the status code: revocation and a typo need to say different
    // things, because the next step differs for each.
    const after = await rpc(admin.request, 'MCPV-REV', 'tools/list');
    expect(refusalOf(after), 'a revoked code cannot open the MCP face')
      .toMatch(/revoked/i);
  });

  test('the name the client sends reaches the owner’s transcript', async () => {
    await createCode(admin.request, admin.csrf, { code: 'MCPV-WHO', label: 'NAMED' });
    const named = await rpc(admin.request, 'MCPV-WHO', 'tools/list', {}, 'Rae From Claude');
    expect(grantedOK(named), JSON.stringify(named.body)).toBe(true);

    // The web path has a "who are you" popup; this surface has no interface to pop
    // one up on -- but that's no excuse for the owner's side to see a transcript with
    // no attributed source.
    const convos = await admin.request.get(`${BACKEND}/api/admin/conversations`,
      { headers: { 'X-Csrftoken': admin.csrf } });
    expect(convos.status()).toBe(200);
    expect(JSON.stringify(await convos.json()),
      'the owner can tell who this was').toContain('Rae From Claude');
  });

  test('the member allowance is the code’s allowance here too', async () => {
    await createCode(admin.request, admin.csrf,
      { code: 'MCPV-CAP', label: 'CAPPED', max_members: 1 });
    // The first name gets in first -- a positive control; without it, the second
    // being blocked might have nothing to do with quota.
    expect(grantedOK(await rpc(admin.request, 'MCPV-CAP', 'tools/list', {}, 'First')),
      'the first name gets in').toBe(true);

    // The second name must be blocked by the exact same quota -- a different surface
    // must not mean a different set of rules. Asserting the message: the same "this
    // code is full" sentence someone reads on the web.
    const second = await rpc(admin.request, 'MCPV-CAP', 'tools/list', {}, 'Second');
    expect(refusalOf(second), 'a full code admits no one new, on any face')
      .toMatch(/full|no more names/i);
  });
});
