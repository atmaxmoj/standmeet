// c3-mcp-client-stdio.spec.ts —— Phase C-3: @standmeet/mcp-client SDK 走通。
//
// owner 通过 admin 生成 keypair → 写 credentials.json → Claude Desktop spawn
// `node sdk/packages/mcp-client/bin/standmeet-mcp` 子进程 → 子进程 stdio
// 跟 e2e 通信 → 转发到 backend /mcp。验：me 工具返 owner profile。
//
// 这跟 e2e/fixtures/mcp.ts (HTTP + Sigv1 直发) 不同 —— 那条覆盖 backend
// 验签；本 spec 覆盖 SDK 子进程的 creds load + sign + stdio bridge。

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
// MeResp —— `me` 的载荷是 {owner:{…}, settings:{…}}。两个面同一份载荷之后,MCP 不再有
// 自己那份扁平的;按扁平解会得到一串 undefined,而失败信息看不出是形状变了。
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
