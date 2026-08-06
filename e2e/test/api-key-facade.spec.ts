// api-key-facade.spec.ts —— 【对外】the API-key facade (/api/pub/v1) behavior: a Bearer smk_ key
// resolves to a role snapshot and calls capabilities as HTTP endpoints (no LLM, no gas). Proves the
// two gates on top of role assembly — candidacy (opened) + the non-Agentic whitelist — plus auth,
// per-key denials, revocation, and QUERY/POST dispatch. Keys are minted via the owner-MCP
// api_keys.create tool (the product's MCP-first management surface).

import { test, expect } from '@/fixtures/test';

import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, callToolOutcome, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'apikey-facade@example.com', password: 'correct-horse-battery-staple',
  handle: 'apikeyfacade', fullName: 'API Key Facade Owner',
};

let token = ''; // owner MCP token
let sid = '';
let secret = ''; // the smk_ key
let keyID = '';

interface MintResp { id: string; prefix: string; secret: string }

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'facade-role', description: 'role for api-key facade spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  token = await createAPIToken(request, csrf, 'apikey-facade');
  sid = await initMCP(request, token);
  const mint = await callTool<MintResp>(request, token, sid, 'api_keys.create', {
    label: 'facade-key', assumed_role_id: role.id,
  });
  secret = mint.secret;
  keyID = mint.id;
  await callTool(request, token, sid, 'api.open', { capability_id: 'corpus.retrieval' });
  await request.dispose();
}

async function run(
  playwright: Playwright, fn: (r: APIRequestContext) => Promise<void>,
): Promise<void> {
  const request = await playwright.request.newContext();
  await fn(request);
  await request.dispose();
}

// facadeDiscover / facadeCall —— hit the pubapi facade with a raw Bearer smk_ key.
async function facadeDiscover(r: APIRequestContext, key: string) {
  return r.get(`${BACKEND}/api/pub/v1/tools`, { headers: { Authorization: `Bearer ${key}` } });
}
async function facadeCall(
  r: APIRequestContext, key: string, method: string, name: string, body: unknown,
) {
  return r.fetch(`${BACKEND}/api/pub/v1/tools/${name}`, {
    method, headers: { Authorization: `Bearer ${key}` }, data: body ?? {},
  });
}

interface DiscoverBody { tools: Array<{ name: string; read_only: boolean }> }

async function checkDiscovery(r: APIRequestContext): Promise<void> {
  const res = await facadeDiscover(r, secret);
  expect(res.status(), 'discovery ok').toBe(200);
  const body = await res.json() as DiscoverBody;
  const names = body.tools.map((t) => t.name).sort();
  expect(names, 'opened corpus.retrieval → its 4 tools render')
    .toEqual(['corpus_links', 'corpus_list', 'corpus_read', 'corpus_search']);
  // Agentic tools never render on the api facade.
  for (const agentic of ['ask_visitor', 'summarize', 'mail_send']) {
    expect(names, `Agentic ${agentic} absent`).not.toContain(agentic);
  }
  expect(body.tools.find((t) => t.name === 'corpus_search')?.read_only, 'search is read-only')
    .toBe(true);
}

async function checkDispatch(r: APIRequestContext): Promise<void> {
  const q = await facadeCall(r, secret, 'QUERY', 'corpus_search', { query: 'anything' });
  expect(q.status(), 'QUERY corpus_search dispatches').toBe(200);
  expect(await q.text(), 'returns a result envelope').toContain('result');

  const p = await facadeCall(r, secret, 'POST', 'corpus_search', { query: 'anything' });
  expect(p.status(), 'POST also allowed on a read tool').toBe(200);
}

async function checkAuthRejections(r: APIRequestContext): Promise<void> {
  const none = await r.get(`${BACKEND}/api/pub/v1/tools`);
  expect(none.status(), 'no auth → 401').toBe(401);
  const garbage = await facadeDiscover(r, 'smk_totally-made-up-key');
  expect(garbage.status(), 'unknown key → 401').toBe(401);
  const nonPrefix = await facadeDiscover(r, 'not-even-an-smk-token');
  expect(nonPrefix.status(), 'malformed key → 401').toBe(401);
}

async function checkCandidacyGate(r: APIRequestContext): Promise<void> {
  // close corpus.retrieval (owner-scoped) → the key's toolset empties → 404 on dispatch.
  await callTool(r, token, sid, 'api.close', { capability_id: 'corpus.retrieval' });
  const closed = await facadeCall(r, secret, 'QUERY', 'corpus_search', { query: 'x' });
  expect(closed.status(), 'not-opened capability → 404').toBe(404);
  const disc = await facadeDiscover(r, secret);
  expect((await disc.json() as DiscoverBody).tools, 'discovery empty when closed').toHaveLength(0);
  // reopen for the other tests.
  await callTool(r, token, sid, 'api.open', { capability_id: 'corpus.retrieval' });
  const reopened = await facadeCall(r, secret, 'QUERY', 'corpus_search', { query: 'x' });
  expect(reopened.status(), 'reopened → 200').toBe(200);
}

async function checkPerKeyDenial(r: APIRequestContext): Promise<void> {
  await callTool(r, token, sid, 'api_keys.add_denial',
    { key_id: keyID, kind: 'capability', target_id: 'corpus.retrieval' });
  const denied = await facadeCall(r, secret, 'QUERY', 'corpus_search', { query: 'x' });
  expect(denied.status(), 'per-key denial removes the tool → 404').toBe(404);
  await callTool(r, token, sid, 'api_keys.remove_denial',
    { key_id: keyID, kind: 'capability', target_id: 'corpus.retrieval' });
  const restored = await facadeCall(r, secret, 'QUERY', 'corpus_search', { query: 'x' });
  expect(restored.status(), 'denial lifted → 200').toBe(200);
}

async function checkRevocation(r: APIRequestContext): Promise<void> {
  const mint = await callTool<MintResp>(r, token, sid, 'api_keys.create',
    { label: 'doomed', assumed_role_id: (await roleOf(r)) });
  const ok = await facadeDiscover(r, mint.secret);
  expect(ok.status(), 'fresh key works').toBe(200);
  await callTool(r, token, sid, 'api_keys.revoke', { id: mint.id });
  const revoked = await facadeDiscover(r, mint.secret);
  expect(revoked.status(), 'revoked key → 401').toBe(401);
}

// checkRevokeNothingSaysSo —— revoking a key that isn't there must not report success, while
// revoking one twice must not report failure. The line between the two is what this pins.
//
// The underlying UPDATE is `... WHERE id = $1 AND owner_id = $2`. An id that doesn't exist (a stale
// list, another tab, another owner's key) matches zero rows, postgres reports no error, and the
// caller used to return nil — so the owner is told a key was revoked while it keeps working. For a
// revoke that is the worst possible lie. The sibling operation on access codes has read its row
// count for a long time (`CodeRepo.Revoke` → ErrCodeInvalid); this half never did.
//
// Revoking an already-revoked key is a different case and stays a success: the row is there, the
// write lands, and the end state is exactly what the owner asked for. "Nothing to write" is a
// failure; "already in the state you asked for" is not. Both halves are here so a later reading of
// the first one can't turn idempotence into an error.
async function checkRevokeNothingSaysSo(r: APIRequestContext): Promise<void> {
  // Well-formed but unknown id — the parse succeeds, so the write is genuinely attempted.
  const ghost = await callToolOutcome(r, token, sid, 'api_keys.revoke',
    { id: '00000000-0000-4000-8000-000000000000' });
  expect(ghost.reachable, 'the call itself must go through (this is not a transport test)').toBe(true);
  expect(ghost.isError, 'revoking a key that does not exist must not report success').toBe(true);

  const mint = await callTool<MintResp>(r, token, sid, 'api_keys.create',
    { label: 'twice', assumed_role_id: (await roleOf(r)) });
  await callTool(r, token, sid, 'api_keys.revoke', { id: mint.id });
  const again = await callToolOutcome(r, token, sid, 'api_keys.revoke', { id: mint.id });
  expect(again.isError, 'revoking twice is idempotent — the key is revoked either way').toBe(false);
  const dead = await facadeDiscover(r, mint.secret);
  expect(dead.status(), 'and it really is revoked').toBe(401);
}

// roleOf —— the seeded role id (api_keys.list carries assumed_role_id).
async function roleOf(r: APIRequestContext): Promise<string> {
  const keys = await callTool<Array<{ id: string; assumed_role_id: string }>>(
    r, token, sid, 'api_keys.list', {});
  return keys[0]!.assumed_role_id;
}

test.describe('API-key facade · /api/pub/v1 行为守护', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('discovery renders opened non-Agentic tools only',
    ({ playwright }) => run(playwright, checkDiscovery));
  test('QUERY + POST dispatch a corpus tool',
    ({ playwright }) => run(playwright, checkDispatch));
  test('missing / unknown / malformed key → 401',
    ({ playwright }) => run(playwright, checkAuthRejections));
  test('candidacy gate: closed capability → 404, reopened → 200',
    ({ playwright }) => run(playwright, checkCandidacyGate));
  test('per-key capability denial subtracts the tool',
    ({ playwright }) => run(playwright, checkPerKeyDenial));
  test('revoked key → 401', ({ playwright }) => run(playwright, checkRevocation));
  test('revoking a key that is not there never reports success',
    ({ playwright }) => run(playwright, checkRevokeNothingSaysSo));
});
