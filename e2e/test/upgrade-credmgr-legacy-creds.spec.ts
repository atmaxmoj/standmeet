// upgrade-credmgr-legacy-creds.spec.ts —— an old volume whose supplier credentials still sit in
// block_connections.credentials_enc + a deploy: the boot moves every value into the
// credential-manager (credmgr) once and empties the column, so credmgr is the one source.
//
// Before: a legacy value self-healed into credmgr only when something happened to read it, and the
// column was never emptied — two copies of the owner's secret, one of them in the bespoke vault
// column the block model retired (docs/design/plugin/access-control.md: "migrating today's rows is a
// one-off"). A legacy blob that no longer decrypts (instance secret rotated) is not a credential at
// all: the boot drops it and marks the connection not connected, which is what the owner sees and
// what the reconnect flow expects.
//
// The pre-upgrade shape is built in SQL with no crypto: credmgr seals with the same cryptobox and the
// same owner-id AAD the legacy column used, so a credmgr blob, base64-decoded, IS a legacy blob.
//
// Access must not move: the upgrade touches credentials only, so a code's visitor tool set is read
// before and after and must be identical.
//
// Serial: the DB is briefly in the old shape mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { MOCK_GCAL_CREDS, getGCalStatus, saveGCalCredentials } from '@/fixtures/gcal';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'credmgr-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'credmgrupg', fullName: 'Credmgr Upgrader',
};
const SUPPLIER = 'google-calendar';
// A second supplier row whose legacy blob no longer decrypts (a rotated instance secret).
const ROTATED = 'telegram';
const CODE = 'CREDMGR-UPG-1';

function count(sql: string): number {
  return Number(querySQL(sql));
}

const secretsFor = (block: string) =>
  count(`SELECT count(*) FROM mcp_credential_manager.records
         WHERE collection = 'secrets' AND doc->>'name' = '${block}'`);
const legacyBytes = () =>
  count('SELECT coalesce(sum(octet_length(credentials_enc)), 0) FROM block_connections');

// visitorTools —— the tool names a code's visitor sees, over the visitor MCP face (initialize →
// tools/list, the path a real client takes).
async function visitorTools(request: APIRequestContext): Promise<string[]> {
  const url = `${BACKEND}/mcp/visitor`;
  const headers = (sid: string): Record<string, string> => ({
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${CODE}`, 'X-Standmeet-Visitor': 'upgrade-probe',
    ...(sid === '' ? {} : { 'Mcp-Session-Id': sid }),
  });
  const init = await request.post(url, {
    headers: headers(''),
    data: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } },
    },
  });
  const sid = init.headers()['mcp-session-id'] ?? '';
  expect(sid, 'the code opens a visitor MCP session').not.toBe('');
  const res = await request.post(url, {
    headers: headers(sid), data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  const body = JSON.parse(line === undefined ? text : line.slice('data:'.length)) as {
    result?: { tools?: { name: string }[] };
  };
  return (body.result?.tools ?? []).map((t) => t.name).sort();
}

let request: APIRequestContext;
let toolsBefore: string[] = [];

test.describe('upgrade · legacy supplier credentials move into credmgr once, at boot', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000);
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await saveGCalCredentials(request, csrf, MOCK_GCAL_CREDS);
    await createCode(request, csrf, { code: CODE, label: 'credmgr upgrade probe' });
  });

  test.afterAll(async () => {
    restartBackend();
    await request.dispose();
  });

  test('an old volume + a deploy → the value is in credmgr, the column is empty, access unchanged',
    async ({ playwright }) => {
      toolsBefore = await visitorTools(request);
      expect(toolsBefore.length, 'the probe code has a tool set to compare').toBeGreaterThan(0);

      // Back to the pre-credmgr shape: the value in the row's column, nothing in credmgr.
      execSQL(`UPDATE block_connections b SET credentials_enc = decode(r.doc->>'blob', 'base64')
               FROM mcp_credential_manager.records r
               WHERE r.collection = 'secrets' AND r.doc->>'name' = b.block_id
                 AND r.doc->>'owner' = b.owner_id::text AND b.block_id = '${SUPPLIER}'`);
      execSQL(`DELETE FROM mcp_credential_manager.records WHERE doc->>'name' = '${SUPPLIER}'`);
      // …and a legacy row whose blob no longer opens, still marked connected. It takes the built-in
      // calendar row's kind: a 'protocol' row would be reloaded as an owner-authored block at boot.
      execSQL(`INSERT INTO block_connections (owner_id, block_id, seam, kind, credentials_enc, connected_at)
               SELECT owner_id, '${ROTATED}', 'im', kind,
                      '\\x00112233445566778899aabbccddeeff00112233'::bytea, now()
               FROM block_connections WHERE block_id = '${SUPPLIER}'`);
      expect(secretsFor(SUPPLIER), 'pre-state not built: credmgr still holds the value').toBe(0);
      expect(legacyBytes(), 'pre-state not built: no legacy bytes').toBeGreaterThan(0);

      // Upgrade = deploy. No other action — in particular no read that would self-heal a row.
      restartBackend();

      expect(legacyBytes(), 'no credential is left in block_connections').toBe(0);
      expect(secretsFor(SUPPLIER), 'the readable legacy value moved into credmgr').toBe(1);
      expect(querySQL(`SELECT connected_at IS NULL FROM block_connections WHERE block_id = '${ROTATED}'`),
        'an unreadable legacy blob is no credential: that row reads not connected').toBe('t');
      expect(secretsFor(ROTATED), 'nothing unreadable was copied into credmgr').toBe(0);

      await request.dispose();
      request = await playwright.request.newContext();
      await loginAPI(request, OWNER.email, OWNER.password);
      expect((await getGCalStatus(request)).has_credentials,
        'the owner still has the calendar credentials they saved before the upgrade').toBe(true);
      expect(await visitorTools(request), 'the upgrade changed no code\'s tool set').toEqual(toolsBefore);
    });

  test('…a second boot changes nothing (the move runs once in effect)', async ({ playwright }) => {
    restartBackend();
    // A fresh context: the old one's keep-alive socket points at the process the restart killed.
    await request.dispose();
    request = await playwright.request.newContext();
    await loginAPI(request, OWNER.email, OWNER.password);
    expect(legacyBytes()).toBe(0);
    expect(secretsFor(SUPPLIER), 'still exactly one credmgr record').toBe(1);
    expect((await getGCalStatus(request)).has_credentials).toBe(true);
    expect(await visitorTools(request)).toEqual(toolsBefore);
  });
});
