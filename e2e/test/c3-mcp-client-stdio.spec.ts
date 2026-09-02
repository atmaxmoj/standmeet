// c3-mcp-client-stdio.spec.ts — Phase C-3: end-to-end through the @standmeet/mcp-client SDK.
//
// The owner generates a keypair via admin → writes credentials.json → Claude Desktop spawns
// the `node sdk/packages/mcp-client/bin/standmeet-mcp` child process → the child process
// talks to e2e over stdio → forwards to backend /mcp. Verify: the `me` tool returns the
// owner profile.
//
// This differs from e2e/fixtures/mcp.ts (HTTP + Sigv1 sent directly) — that one covers
// backend signature verification; this spec covers the SDK child process's creds load +
// sign + stdio bridge.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair } from '@/fixtures/keypair';
import { spawnStdioMCP } from '@/fixtures/mcp-stdio';

const OWNER = {
  email: 'c3@example.com', password: 'correct-horse-battery-staple',
  handle: 'c3', fullName: 'C-Three Owner',
};

interface ToolCallResult { content?: Array<{ type: string; text?: string }>; isError?: boolean }
// MeResp — `me`'s payload is {owner:{…}, settings:{…}}. Now that both surfaces share one
// payload, MCP no longer has its own flat one; parsing it as flat yields a run of
// undefined, and the failure message won't show that the shape changed.
interface MeResp { owner?: { email: string; handle: string; full_name: string } }

test.describe('Phase C-3 @standmeet/mcp-client stdio bridge', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('spawn SDK → initialize → call me via stdio → returns owner profile',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'c3-stdio-laptop');
      await request.dispose();

      const client = await spawnStdioMCP({
        keyId: kp.key_id,
        privateKeyPem: kp.private_key_pem,
      });
      try {
        const result = await client.call('tools/call', {
          name: 'me', arguments: {},
        }, 42) as ToolCallResult;
        expect(result.isError ?? false).toBe(false);
        const content = result.content?.[0];
        expect(content?.type).toBe('text');
        const me = JSON.parse(content?.text ?? '{}') as MeResp;
        expect(me.owner, 'me returns an owner block').toBeTruthy();
        expect(me.owner?.email).toBe(OWNER.email);
        expect(me.owner?.handle).toBe(OWNER.handle);
      } finally {
        client.close();
      }
    });
});
