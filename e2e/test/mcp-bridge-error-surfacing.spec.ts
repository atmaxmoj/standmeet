// mcp-bridge-error-surfacing.spec.ts — the bridge must SURFACE a server error, never swallow it.
//
// The bug: a full-vault obsidian.import (6MB) exceeds the backend's 30s http WriteTimeout, so the
// server aborts the response with a plain-text "Internal Server Error" (not JSON-RPC). The bridge's
// parseMCPText only understands `{…}` JSON or `data:` SSE, so it returned undefined and wrote NOTHING
// to stdout — and the MCP client waited forever for a reply that never came (a 30-minute hang doing
// nothing). A request must ALWAYS get a response: parseable result, or a synthesized JSON-RPC error.
//
// Real end-to-end through the actual spawned bridge, pointed at a mock /mcp that returns a valid
// initialize but a non-JSON-RPC 500 for the tool call — exactly the WriteTimeout-abort shape.

import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { test, expect } from '@/fixtures/test';

import { spawnStdioMCP } from '@/fixtures/mcp-stdio';

// A mock /mcp: initialize succeeds (so the bridge can boot), the tool call returns a bare 500.
function startMockMCP(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c as string; });
    req.on('end', () => {
      let msg: { id?: unknown; method?: string } = {};
      try { msg = JSON.parse(buf) as typeof msg; } catch { /* not json */ }
      if (msg.method === 'initialize') {
        res.setHeader('Mcp-Session-Id', 'mock-session');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '0.0.1' } },
        }));
        return;
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      // Everything else (the tool call) → the WriteTimeout-abort shape: a bare 500, no JSON-RPC.
      res.writeHead(500); res.end('Internal Server Error');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test.describe('bridge surfaces server errors instead of hanging', () => {
  test('a non-JSON-RPC 500 from /mcp comes back as a prompt JSON-RPC error, not a silent hang',
    async () => {
      const { server, url } = await startMockMCP();
      // A real Ed25519 key so the bridge's creds load + signing succeed; the mock ignores the sig.
      const { privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const client = await spawnStdioMCP(
        { keyId: 'mock-key', privateKeyPem: privateKey },
        { env: { STANDMEET_HOST: url } },
      );
      try {
        const t0 = Date.now();
        let errMsg = '';
        try {
          await client.call('tools/call', { name: 'obsidian.import', arguments: { files: [] } }, 7);
        } catch (e) {
          errMsg = String(e);
        }
        const ms = Date.now() - t0;
        // Before the fix: nothing is written, the call only ends via the fixture's 10s rpc timeout.
        expect(errMsg, 'the call surfaced an error rather than hanging silently').not.toBe('');
        expect(errMsg, 'it is a real server error, NOT the fixture timeout (which means a hang)')
          .not.toMatch(/timeout/i);
        expect(ms, 'the error came back promptly, not after a long hang').toBeLessThan(5000);
      } finally {
        client.close();
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
});
