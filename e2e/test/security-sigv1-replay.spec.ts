// security-sigv1-replay.spec.ts —— pentest / **documenting**。MCP Sigv1 auth 用 ts ±5min 窗口
// 防重放,但**没有 nonce**:同一个签名头在窗口内可被重放(认证仍通过)。这是**已知、有界**的
// 弱点(窗口 5min,且要先窃到一个合法签名头),此测试把当前行为钉死:重放同头 → 仍认证成功。
// 若将来要加 nonce/one-time challenge,本测试翻成 RED-first(重放应被拒)驱动那个修复。
//
// 对照:c1-keypair-auth 已测「过期 ts 被拒」;这里补「窗口内重放被接受」这一面。

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

  test('a captured Sigv1 header replays successfully within the ±5min window (no nonce)',
    async ({ playwright }) => {
      const kp = await createKeypair(seed.request, seed.csrf, 'replay-spec');
      const request = await playwright.request.newContext();
      // One signed header, reused verbatim (same ts + sig) — simulates a captured/leaked header.
      const header = formatAuthHeader(signNow(kp.private_key_pem, kp.key_id));

      const first = await mcpInit(request, header);
      expect(first, 'original signed request authenticates').toBeLessThan(400);
      // Replay the EXACT same header: no nonce ⇒ still accepted (bounded by the 5min window).
      const replay = await mcpInit(request, header);
      expect(replay, 'in-window replay is currently accepted (no nonce — documented)')
        .toBeLessThan(400);
      await request.dispose();
    });
});
