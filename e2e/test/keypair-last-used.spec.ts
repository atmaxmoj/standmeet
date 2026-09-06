// keypair-last-used.spec.ts —— #2: the owner-MCP keypair management panel shows WHERE a key was
// last used (device · ip), not just when. A real Sigv1-signed MCP request stamps the keypair's
// last_used_ip + last_used_user_agent (verify logic itself is untouched); the admin list returns
// them and the panel row renders them, so a stale or leaked key is recognizable before revoking.
//
// Covers both the capability (the signed request records ip/ua, the list returns them) and the face
// (the api·mcp row shows the "device · ip" line). RED before: no ip/ua columns, no row line.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair, listKeypairs } from '@/fixtures/keypair';
import { formatAuthHeader, signNow } from '@/fixtures/sigv1';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'kpused@example.com', password: 'correct-horse-battery-staple',
  handle: 'kpused', fullName: 'Keypair Used Owner',
};
const LABEL = 'lastused-spec';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner-MCP keypair records + shows last-used device / ip', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('a signed MCP request stamps device+ip, and the panel row shows them',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, LABEL);

      // A fresh key has never been used — no origin recorded yet.
      const before = (await listKeypairs(request, csrf)).find((k) => k.key_id === kp.key_id);
      expect(before?.last_used_at, 'unused key has no last-used time').toBeNull();
      expect(before?.last_used_ip, 'unused key has no ip').toBeNull();

      // One real Sigv1-signed MCP request → the verify path stamps last_used_ip + user_agent.
      await signedMcpInit(request, kp.key_id, kp.private_key_pem);

      const after = (await listKeypairs(request, csrf)).find((k) => k.key_id === kp.key_id);
      expect(after?.last_used_at, 'used key has a last-used time').not.toBeNull();
      expect(after?.last_used_ip, 'used key records the source ip').toBeTruthy();
      expect(after?.last_used_user_agent, 'used key records the device (user-agent)').toBeTruthy();

      // The panel row renders the device · ip line.
      await gotoAdminSection(adminPage, 'api-mcp');
      await expect(adminPage.getByTestId(`token-lastused-${LABEL}`),
        'the keypair row shows where it was last used').toBeVisible({ timeout: 10_000 });
      await request.dispose();
    });
});

// signedMcpInit — one Sigv1-signed MCP initialize (the smallest real request that passes verify).
async function signedMcpInit(request: APIRequestContext, keyID: string, pem: string): Promise<void> {
  const res = await request.post(`${BACKEND}/mcp`, {
    headers: {
      Authorization: formatAuthHeader(signNow(pem, keyID)),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'kpused-spec', version: '1' },
      },
    },
  });
  expect(res.status(), 'signed MCP init succeeds').toBe(200);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
