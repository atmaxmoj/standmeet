// mcp-version-skew.spec.ts — the real mcp-client bin's version-skew advisory now follows the actual
// versions, because the client version is stamped from the same git tag the server uses (no longer a
// frozen 0.0.0 that made the advisory fire for every client always).
//
// It builds the real bin twice — once stamped to match the instance, once older — and drives its
// stdio bridge with an `initialize`:
//   - matched (client == instance): the bin initializes but writes NO advisory (guarded by a positive
//     assertion that it really connected — stdout carries the instance version — so "no advisory" is
//     meaningful, not a vacuous absence).
//   - older (client < instance): the bin writes ONE advisory to stderr naming update_self + both
//     versions, and stdout stays the clean JSON-RPC channel.
//
// RED-reachability: before the fix the client version is a frozen 0.0.0, so even the "matched" build
// reports 0.0.0 != the instance and the advisory fires → the matched-case assertion goes red.

import { test, expect } from '@/fixtures/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair } from '@/fixtures/keypair';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const REPO = join(__dirname, '../..');
const BIN = join(REPO, 'sdk/packages/mcp-client/bin/standmeet-mcp');
const ADVISORY = '[standmeet-mcp]';

const OWNER = {
  email: 'versionskew@example.com', password: 'correct-horse-battery-staple',
  handle: 'versionskew', fullName: 'Version Skew Owner',
};

const INIT = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', blocks: {}, clientInfo: { name: 'skew-e2e', version: '0' } },
});

// buildClient — rebuild the real bin stamped with `version` via STANDMEET_VERSION (the fix: the
// client version follows that single source, the same the server uses).
function buildClient(version: string): void {
  const r = spawnSync('pnpm', ['-F', '@standmeet/mcp-client', 'build'], {
    cwd: REPO, env: { ...process.env, STANDMEET_VERSION: version }, encoding: 'utf8',
  });
  expect(r.status, `client build (v=${version}) failed: ${r.stderr}`).toBe(0);
}

// initializeOnce — spawn the real bin, send one initialize, collect stdout+stderr until the
// initialize result lands on stdout, then stop.
async function initializeOnce(credsPath: string): Promise<{ stdout: string; stderr: string }> {
  const proc = spawn('node', [BIN], {
    env: { ...process.env, STANDMEET_HOST: BACKEND, STANDMEET_CREDS_PATH: credsPath },
  });
  const out = { stdout: '', stderr: '' };
  proc.stdout.on('data', (d: Buffer) => { out.stdout += d.toString(); });
  proc.stderr.on('data', (d: Buffer) => { out.stderr += d.toString(); });
  proc.stdin.write(INIT + '\n');
  await expect.poll(() => out.stdout, {
    message: 'the bin forwarded initialize and got the instance result', timeout: 20_000,
  }).toContain('serverInfo');
  proc.stdin.end();
  proc.kill();
  return out;
}

test.describe('MCP client version-skew advisory follows the real versions', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('matched client → no advisory; an older client → advisory naming update_self',
    async ({ playwright }) => {
      test.setTimeout(180_000);
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);

      // A signed keypair, written where the bin expects its creds.
      const key = await createKeypair(request, csrf, 'skew-e2e');
      const dir = await mkdtemp(join(tmpdir(), 'skew-'));
      const credsPath = join(dir, 'creds.json');
      await writeFile(credsPath, JSON.stringify({ keyId: key.key_id, privateKeyPem: key.private_key_pem }));

      // The instance self-reports a real version — the whole advisory is moot on an unparseable "dev".
      const inst = (await (await request.get(`${BACKEND}/api/v1/instance`)).json()) as { version?: string };
      const serverVersion = inst.version ?? '';
      expect(serverVersion, 'the instance reports a real semver').toMatch(/^v?\d+\.\d+\.\d+/);
      expect(serverVersion, 'and it is above the "older" client used below').not.toBe('v0.0.0');

      // Matched: a client stamped to the instance's version stays silent.
      buildClient(serverVersion);
      const matched = await initializeOnce(credsPath);
      expect(matched.stdout, 'the bin really connected + initialized').toContain(serverVersion);
      expect(matched.stderr, 'a matched client must not nag').not.toContain(ADVISORY);

      // Older: a client below the instance is advised to update_self.
      buildClient('v0.0.0');
      const older = await initializeOnce(credsPath);
      expect(older.stderr, 'an older client is advised').toContain(ADVISORY);
      expect(older.stderr, 'the advisory names the update tool').toContain('update_self');
      expect(older.stderr, 'and names the instance version').toContain(serverVersion);
      expect(older.stdout, 'the advisory did not leak into the JSON-RPC channel').not.toContain(ADVISORY);

      await request.dispose();
    });
});
