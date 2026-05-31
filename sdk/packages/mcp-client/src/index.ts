// index.ts —— @standmeet/mcp-client 入口。bin/standmeet-mcp 调 main()。
//
// Env vars (jam through Claude Desktop / Cursor MCP server config):
//   STANDMEET_HOST         — backend base URL (e.g. https://standmeet.local)
//   STANDMEET_CREDS_PATH   — path to credentials.json {keyId, privateKeyPem}

import { loadCreds } from './creds.js';
import { runBridge } from './bridge.js';

export async function main(): Promise<void> {
  const host = process.env['STANDMEET_HOST'];
  const credsPath = process.env['STANDMEET_CREDS_PATH'];
  if (!host) throw new Error('STANDMEET_HOST env var required');
  if (!credsPath) throw new Error('STANDMEET_CREDS_PATH env var required');
  const creds = await loadCreds(credsPath);
  await runBridge({ host, creds });
}

export type { Creds } from './creds.js';
export { signAuthHeader } from './sigv1.js';
