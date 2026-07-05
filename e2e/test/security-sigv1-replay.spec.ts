// security-sigv1-replay.spec.ts —— pentest / **fix**。MCP Sigv1 auth 现在签一次性 nonce:
// 后端把见过的 (keyId,nonce) 记 Redis(窗口 TTL),窗口内重放**同一个签名头** → nonce 已见 → 拒。
// 捕获一个合法头也无法重放。fresh 签(新 nonce)不受影响。
//
// 对照:c1-keypair-auth 已测「过期 ts 被拒」;这里守「窗口内重放被拒 + fresh 仍通」。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { createKeypair } from '@/fixtures/keypair';
import { signNow, formatAuthHeader } from '@/fixtures/sigv1';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function mcpInit(request: APIRequestContext, authHeader: string): Promise<number> {
  const res = await request.post(`${BACKEND}/mcp`, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'sigv1-replay-spec', version: '1' },
      },
    },
  });
  return res.status();
}

test.describe('pentest · Sigv1 in-window replay (documented known weakness)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('a captured Sigv1 header cannot be replayed (one-time nonce); a fresh sign still works',
    async ({ playwright }) => {
      const kp = await createKeypair(seed.request, seed.csrf, 'replay-spec');
      const request = await playwright.request.newContext();
      // One signed header, reused verbatim (same ts + nonce + sig) — a captured/leaked header.
      const header = formatAuthHeader(signNow(kp.private_key_pem, kp.key_id));

      const first = await mcpInit(request, header);
      expect(first, 'original signed request authenticates').toBeLessThan(400);
      // Replay the EXACT same header: nonce already seen ⇒ rejected (401).
      const replay = await mcpInit(request, header);
      expect(replay, 'in-window replay of the same nonce is rejected').toBeGreaterThanOrEqual(400);

      // A freshly-signed header (new nonce) still authenticates — nonce doesn't break normal use.
      const fresh = formatAuthHeader(signNow(kp.private_key_pem, kp.key_id));
      const freshStatus = await mcpInit(request, fresh);
      expect(freshStatus, 'a fresh nonce authenticates normally').toBeLessThan(400);
      await request.dispose();
    });
});
