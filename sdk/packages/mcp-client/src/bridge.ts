// bridge.ts —— stdio JSON-RPC ↔ streamable HTTP forwarder.
//
// Claude Desktop / Cursor spawn this process and talk to it over stdio
// JSON-RPC. Each stdin line is a JSON-RPC message → POST to backend /mcp
// (with Sigv1 sig + Mcp-Session-Id) → parse the response (JSON or SSE
// data:) → write one line of JSON back to stdout.
//
// Design: keep session_id across requests; all other state (including the
// sig) is stateless.

import { createInterface } from 'node:readline';

import type { Creds } from './creds.js';
import { signAuthHeader } from './sigv1.js';

export interface BridgeOptions {
  host: string;
  creds: Creds;
}

export async function runBridge(opts: BridgeOptions): Promise<void> {
  let sessionId: string | undefined;
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const result = await forward(opts, trimmed, sessionId);
    if (result.sessionId) sessionId = result.sessionId;
    if (result.body) process.stdout.write(result.body + '\n');
  }
}

interface ForwardResult {
  sessionId?: string;
  body?: string;
}

async function forward(
  opts: BridgeOptions, jsonRpcLine: string, sessionId: string | undefined,
): Promise<ForwardResult> {
  const headers: Record<string, string> = {
    Authorization: signAuthHeader(opts.creds),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(`${opts.host}/mcp`, {
    method: 'POST', headers, body: jsonRpcLine,
  });
  const text = await res.text();
  return {
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    body: parseMCPText(text),
  };
}

// Under streamable HTTP the backend can return either application/json or
// text/event-stream. SSE responses look like `event: message\ndata: {...}\n\n`;
// pick out the `data:` line and trim it.
function parseMCPText(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (trimmed.startsWith('{')) return trimmed;
  const dataLine = trimmed.split('\n').find((l) => l.startsWith('data:'));
  return dataLine?.slice(5).trim();
}
