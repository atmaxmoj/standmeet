// index.ts —— @standmeet/mcp-client entry point. bin/standmeet-mcp calls main().
//
// Env vars (set through the Claude Desktop / Cursor MCP server config):
//   STANDMEET_HOST         — backend base URL (e.g. https://standmeet.local)
//   STANDMEET_CREDS_PATH   — path to credentials.json {keyId, privateKeyPem}
//
// Run with --help or --version for a human-readable summary; with no flags it runs the
// stdio↔HTTP bridge, which is how an MCP client invokes it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadCreds } from './creds.js';
import { runBridge } from './bridge.js';

const HELP = `standmeet-mcp — MCP bridge to a StandMeet instance (drive your corpus from your AI client).

Usage:
  standmeet-mcp             run the stdio<->HTTP bridge (how Claude Desktop / Cursor invoke it)
  standmeet-mcp --help      show this help
  standmeet-mcp --version   print the client version

Environment (set these in your MCP client's server config):
  STANDMEET_HOST            backend base URL, e.g. https://sijie.xyz
  STANDMEET_CREDS_PATH      path to credentials.json { keyId, privateKeyPem }
                            (generate the keypair at <STANDMEET_HOST>/admin/api-mcp)

Once connected, the server hands your agent its own instructions on how to curate the corpus
(raw -> wiki -> output), and your agent can call instance.upgrade_check to see whether a newer
StandMeet is available.
`;

// __MCP_CLIENT_VERSION__ — replaced at build by tsup's `define` with the build's STANDMEET_VERSION
// (the git tag), the same single source the server stamps into its own version. Empty on an
// unstamped local build.
declare const __MCP_CLIENT_VERSION__: string;

// clientVersion — the build-stamped version (follows the big version / git tag), falling back to the
// package's own package.json only for an unstamped local build.
function clientVersion(): string {
  if (__MCP_CLIENT_VERSION__) {
    return __MCP_CLIENT_VERSION__;
  }
  try {
    const p = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes('-v') || args.includes('--version')) {
    process.stdout.write(`${clientVersion()}\n`);
    return;
  }

  const host = process.env['STANDMEET_HOST'];
  const credsPath = process.env['STANDMEET_CREDS_PATH'];
  if (!host) throw new Error('STANDMEET_HOST env var required (run with --help for usage)');
  if (!credsPath) throw new Error('STANDMEET_CREDS_PATH env var required (run with --help for usage)');
  const creds = await loadCreds(credsPath);
  await runBridge({ host, creds, clientVersion: clientVersion() });
}

export type { Creds } from './creds.js';
export { signAuthHeader } from './sigv1.js';
