// sigv1-binds-the-request.spec.ts —— an owner MCP signature covers the request it was made for.
//
// Refactor ledger R6 (2026-10-06): the Sigv1 signature covered only keyId + ts + nonce. Whoever saw
// one header (a proxy log, a debugging dump) could, within the 5-minute window, put it on a
// different request to the full-power /mcp endpoint — corpus.delete, the instance self-upgrade. The
// bound form (`v=2`) also signs the method, the path and a hash of the body.
//
// Asserted: a bound signature over the exact request is accepted; the same signature on a changed
// body, or claiming another method or path, is refused.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair } from '@/fixtures/keypair';
import { signBound } from '@/fixtures/sigv1';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'sigv1-bound@example.com', password: 'correct-horse-battery-staple',
  handle: 'sigv1bound', fullName: 'Sigv1 Bound Owner',
};
const INIT = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bound-spec', version: '1' } },
});

let key = { key_id: '', private_key_pem: '' };

test.describe('a Sigv1 signature is bound to its request', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    key = await createKeypair(request, csrf, 'bound-spec');
    await request.dispose();
  });

  test('signed over this exact request → accepted', async ({ request }) => {
    const auth = signBound(key.private_key_pem, key.key_id, { method: 'POST', path: '/mcp', body: INIT });
    expect((await postMCP(request, auth, INIT)).status()).toBe(200);
  });

  test('the same signature on a different body → refused', async ({ request }) => {
    const auth = signBound(key.private_key_pem, key.key_id, { method: 'POST', path: '/mcp', body: INIT });
    const other = INIT.replace('bound-spec', 'someone-else');
    expect((await postMCP(request, auth, other)).status()).toBe(401);
  });

  test('a signature made for another method or path → refused', async ({ request }) => {
    const asGet = signBound(key.private_key_pem, key.key_id, { method: 'GET', path: '/mcp', body: INIT });
    expect((await postMCP(request, asGet, INIT)).status(), 'signed as GET, sent as POST').toBe(401);
    const asPackage = signBound(key.private_key_pem, key.key_id,
      { method: 'POST', path: '/api/mcp-package', body: INIT });
    expect((await postMCP(request, asPackage, INIT)).status(), 'signed for another path').toBe(401);
  });
});

async function postMCP(request: APIRequestContext, auth: string, body: string) {
  return request.post(`${BACKEND}/mcp`, {
    headers: {
      Authorization: auth, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: body,
  });
}
