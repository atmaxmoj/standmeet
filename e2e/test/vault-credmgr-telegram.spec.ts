// vault-credmgr-telegram.spec.ts — everything-is-a-block S2/S3: a supplier credential is stored
// via the credential-manager (credmgr → db block), not the bespoke vault column.
//
// The owner connects a Telegram bot (create → credentials → connect, the same lane as the admin
// UI). After connect: the credential VALUE lives in credmgr's schema (mcp_credential_manager) — not
// in block_connections.credentials_enc, which is now empty for the row — and the bridge endpoint
// (which reads through credmgr) still hands back the token. This proves the write→credmgr and
// read→credmgr path end to end, with the value moved OFF the vault column.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { querySQL } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'vaultcredmgr@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'vaultcredmgr',
  fullName: 'Vault Credmgr Owner',
};
const TOKEN = '7654321:BOTFATHER-vaultcredmgr-abcdefghijklmnopqrstuv';

async function api(
  request: APIRequestContext, csrf: string, method: 'post', path: string, data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request[method](`${BACKEND}/api/admin/suppliers${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status(), body };
}

async function imToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${BACKEND}/internal/im/config`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { telegram_token?: unknown };
  return typeof body.telegram_token === 'string' ? body.telegram_token : '<missing>';
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('supplier credential stored via credential-manager, not the vault column', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('connect a telegram bot → value in credmgr, vault column empty, token round-trips',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const created = await api(request, csrf, 'post', '/',
        { kind: 'credential', seam: 'im' });
      expect(created.status, 'create telegram supplier').toBeLessThan(300);
      const id = created.body['id'] as string;
      expect(id).toBeTruthy();

      expect((await api(request, csrf, 'post', `/${id}/credentials`, { token: TOKEN })).status)
        .toBeLessThan(300);
      expect((await api(request, csrf, 'post', `/${id}/connect`, {})).status).toBe(200);

      // The credential value now lives in the credential-manager's schema (a sealed row).
      const credmgrRows = querySQL('SELECT count(*) FROM mcp_credential_manager.records');
      expect(Number(credmgrRows), 'credential stored in credmgr').toBeGreaterThan(0);

      // And it moved OFF the bespoke vault column: block_connections.credentials_enc is empty.
      const legacyLen = querySQL(
        `SELECT coalesce(octet_length(credentials_enc), 0) FROM block_connections WHERE block_id = '${id}'`,
      );
      expect(Number(legacyLen), 'legacy vault column emptied').toBe(0);

      // The bridge (reading through credmgr) still hands back the owner's token.
      expect(await imToken(request), 'token round-trips through credmgr').toBe(TOKEN);
    });
});
