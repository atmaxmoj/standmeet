// bridge.ts —— stdio JSON-RPC ↔ streamable HTTP forwarder。
//
// Claude Desktop / Cursor spawn 这个进程，通过 stdio JSON-RPC 跟 MCP server
// 说话。每条 stdin line 是一个 JSON-RPC message → POST 到 backend /mcp
// (带 Sigv1 sig + Mcp-Session-Id) → 解响应 (JSON 或 SSE data:) → 写一行
// JSON 回 stdout。
//
// 设计：保持 session_id 跨 request；其他 state (包括 sig) 全 stateless。

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

// Backend 在 streamable HTTP 下既可返 application/json 也可 text/event-stream。
// SSE 模式响应体形如 `event: message\ndata: {...}\n\n`，挑 `data:` 行 trim。
function parseMCPText(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (trimmed.startsWith('{')) return trimmed;
  const dataLine = trimmed.split('\n').find((l) => l.startsWith('data:'));
  return dataLine?.slice(5).trim();
}
