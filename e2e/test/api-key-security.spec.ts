// api-key-security.spec.ts —— 【对外】adversarial probes on the API-key facade: brute-force,
// DoS (per-key rate limit + body-size bound), and no-leak (a valid outward key must never reach the
// owner control plane). GREEN = the boundary holds.

import { test, expect } from '@/fixtures/test';

import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'apikey-sec@example.com', password: 'correct-horse-battery-staple',
  handle: 'apikeysec', fullName: 'API Key Sec Owner',
};

let token = '';
let sid = '';
let roleID = '';
let goodKey = '';

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
    name: 'sec-role', description: 'role for api-key security spec', corpus_uris: ['wiki://**'],
  });
  roleID = role.id;
  token = await createAPIToken(request, csrf, 'apikey-sec');
  sid = await initMCP(request, token);
  const mint = await callTool<MintResp>(request, token, sid, 'api_keys.create',
    { label: 'good', assumed_role_id: roleID });
  goodKey = mint.secret;
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

function facadeDiscover(r: APIRequestContext, key: string) {
  return r.get(`${BACKEND}/api/pub/v1/tools`, { headers: { Authorization: `Bearer ${key}` } });
}
function facadeQuery(r: APIRequestContext, key: string, body: unknown) {
  return r.fetch(`${BACKEND}/api/pub/v1/tools/corpus_search`, {
    method: 'QUERY', headers: { Authorization: `Bearer ${key}` }, data: body ?? {},
  });
}

// brute-force —— keys are 32-byte random secrets (unguessable); every wrong guess is a flat 401
// with no oracle. Hammering distinct fabricated secrets never yields anything but 401.
async function checkBruteForce(r: APIRequestContext): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const res = await facadeDiscover(r, `smk_fabricated-guess-${i}-${'x'.repeat(40)}`);
    expect(res.status(), `brute-force guess #${i} → 401`).toBe(401);
  }
}

// per-key rate limit —— a key with rate_limit_rpm=5 trips 429 after its budget; a different key is
// unaffected (per-key window isolation). This is the DoS bound on authenticated abuse.
async function checkRateLimit(r: APIRequestContext): Promise<void> {
  const limited = await callTool<MintResp>(r, token, sid, 'api_keys.create',
    { label: 'rate-5', assumed_role_id: roleID, rate_limit_rpm: 5 });
  const statuses: number[] = [];
  for (let i = 0; i < 9; i++) {
    statuses.push((await facadeQuery(r, limited.secret, { query: 'x' })).status());
  }
  expect(statuses[0], 'first request under budget → 200').toBe(200);
  expect(statuses.filter((s) => s === 429).length, 'budget-5 key trips 429').toBeGreaterThan(0);
  // the good (default-limit) key is on its own window → still served.
  expect((await facadeQuery(r, goodKey, { query: 'x' })).status(), 'other key unaffected').toBe(200);
}

// body DoS —— an oversized body is rejected (413), not read unbounded into memory / left to hang.
async function checkBodyDoS(r: APIRequestContext): Promise<void> {
  const huge = `{"query":"${'A'.repeat(2 * 1024 * 1024)}"}`;
  const res = await r.fetch(`${BACKEND}/api/pub/v1/tools/corpus_search`, {
    method: 'POST', headers: { Authorization: `Bearer ${goodKey}` }, data: huge,
  });
  expect([400, 413], 'oversized body bounded, not hung').toContain(res.status());
}

// no-leak —— a valid OUTWARD key must never reach the owner control plane (admin HTTP / owner-MCP),
// and no owner tool ever surfaces in the outward discovery.
async function checkNoLeak(r: APIRequestContext): Promise<void> {
  const admin = await r.get(`${BACKEND}/api/admin/codes/`,
    { headers: { Authorization: `Bearer ${goodKey}` } });
  expect([401, 403], 'api key cannot reach admin HTTP').toContain(admin.status());

  const mcp = await r.post(`${BACKEND}/mcp`, {
    headers: { Authorization: `Bearer ${goodKey}` },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(mcp.status(), 'api key cannot drive owner MCP').not.toBe(200);

  const disc = await facadeDiscover(r, goodKey);
  const names = (await disc.json() as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  for (const owner of ['corpus.create', 'codes.create', 'api_keys.create', 'me']) {
    expect(names, `owner tool ${owner} never in outward discovery`).not.toContain(owner);
  }
}

test.describe('API-key facade · 安全爆破 / DoS / no-leak', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('brute-forcing fabricated keys only ever yields 401',
    ({ playwright }) => run(playwright, checkBruteForce));
  test('per-key rate limit trips 429; other keys isolated',
    ({ playwright }) => run(playwright, checkRateLimit));
  test('oversized request body is bounded (413), not hung',
    ({ playwright }) => run(playwright, checkBodyDoS));
  test('valid outward key cannot reach admin/mcp; no owner tool leaks',
    ({ playwright }) => run(playwright, checkNoLeak));
});
