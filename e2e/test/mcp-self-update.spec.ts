// mcp-self-update.spec.ts — TEST-FIRST for Q5 layer 2: the owner MCP client can update ITSELF from
// the connected instance. (Layer 1, the version-skew advisory, already exists — see
// mcp-version-skew.spec.ts. This spec is the update_self mechanism the advisory points at.)
//
// Design: docs/design/mcp-self-update.md. Reference impl: youteacher_mcp/src/tools/updateSelf.ts.
//
// The shape, end to end:
//   1. The instance SERVES its pinned client tarball at GET /api/mcp-package, gated by the same
//      Sigv1 owner keypair the /mcp transport uses (an anonymous request is refused).
//   2. The mcp-client bridge — which runs on the owner's machine — ADVERTISES an `update_self` tool
//      in tools/list (the server can't: it can't npm-install on the owner's box). The tool is
//      handled locally by the bridge, not forwarded.
//   3. Calling update_self downloads that tarball, `npm i -g` it (into whatever prefix npm is
//      pointed at), replies, and then self-exits ~250ms later so the MCP client respawns it on the
//      next call with the new binary.
//
// Real end-to-end: a signed HTTP GET for the package, and the ACTUAL spawned bridge for the tool —
// the install lands in a throwaway NPM prefix (never the real global), asserted by the package
// appearing under it. Nothing is mocked.

import { access } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair } from '@/fixtures/keypair';
import { spawnStdioMCP } from '@/fixtures/mcp-stdio';
import { formatAuthHeader, signNow } from '@/fixtures/sigv1';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'mcp-selfupdate@example.com', password: 'correct-horse-battery-staple',
  handle: 'mcpselfupdate', fullName: 'MCP Self-Update Owner',
};

interface ToolResult { content?: Array<{ type: string; text?: string }>; isError?: boolean }
interface ToolDef { name: string }
interface ToolList { tools?: ToolDef[] }

test.describe('owner MCP client self-update (Q5 layer 2)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('GET /api/mcp-package streams the client tarball, gated by the owner keypair', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const kp = await createKeypair(request, csrf, 'pkg-fetch');

    // Anonymous → refused. A binary distribution must not be world-readable off the instance.
    const anon = await request.get(`${BACKEND}/api/mcp-package`);
    expect(anon.status(), 'unsigned request is rejected').toBe(401);

    // Signed with the owner keypair (same auth as /mcp) → the tarball.
    const signed = await request.get(`${BACKEND}/api/mcp-package`, {
      headers: { Authorization: formatAuthHeader(signNow(kp.private_key_pem, kp.key_id)) },
    });
    expect(signed.status(), 'a signed request gets the package').toBe(200);
    const body = await signed.body();
    expect(body.byteLength, 'the tarball is non-empty').toBeGreaterThan(1024);
    // gzip magic — a .tgz starts with 0x1f 0x8b.
    expect([body[0], body[1]], 'the body is a gzip tarball').toEqual([0x1f, 0x8b]);
    await request.dispose();
  });

  test('the bridge advertises update_self, and calling it installs the tarball + self-exits',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'self-update-laptop');
      await request.dispose();

      // Point npm's global install at a throwaway prefix — never touch the real global.
      const prefix = await mkdtemp(join(tmpdir(), 'sm-npm-prefix-'));
      const client = await spawnStdioMCP(
        { keyId: kp.key_id, privateKeyPem: kp.private_key_pem },
        { env: { NPM_CONFIG_PREFIX: prefix } },
      );
      try {
        // (a) The client injects update_self into tools/list — the server can't, so the bridge must.
        const list = await client.call('tools/list', {}, 10) as ToolList;
        expect((list.tools ?? []).map((t) => t.name), 'tools/list advertises update_self')
          .toContain('update_self');

        // (b) Calling it downloads /api/mcp-package + `npm i -g` into the throwaway prefix, replies,
        // then self-exits. The reply comes back BEFORE the exit (the tool schedules exit ~250ms
        // after responding).
        const res = await client.call('tools/call', {
          name: 'update_self', arguments: {},
        }, 11) as ToolResult;
        expect(res.isError ?? false, 'update_self did not error').toBe(false);
        expect(res.content?.[0]?.text ?? '', 'the reply reports the install').toMatch(/install|version/i);

        // (c) The package really landed in the throwaway prefix (npm global layout: <prefix>/lib/
        // node_modules/<pkg>), proving fetch → install actually ran.
        await expect(
          access(join(prefix, 'lib', 'node_modules', '@standmeet', 'mcp-client')),
          'the client package installed into the throwaway prefix',
        ).resolves.toBeUndefined();

        // (d) The process self-exits so the MCP client respawns it with the new binary.
        const code = await client.waitExit(5_000);
        expect(code, 'update_self self-exits cleanly for respawn').toBe(0);
      } finally {
        client.close();
      }
    });
});
