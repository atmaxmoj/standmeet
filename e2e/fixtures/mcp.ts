// mcp.ts —— MCP streamable HTTP 客户端 helper（spec 共用）。
//
// initMCP: initialize + notifications/initialized 两连发，返 session-id。
// callTool: 包一层 tools/call，直接返 parsed result text（typed JSON）。
//
// SSE / JSON 双响应模式都吃；session-id header 自动维护。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MCPContentText { type: 'text'; text: string }
interface MCPBlobResource {
  uri: string;
  mimeType?: string;
  blob: string;
}
interface MCPContentResource {
  type: 'resource';
  resource: MCPBlobResource;
}
// Discriminated union; resume.* tools return [text, resource].
export type MCPContent = MCPContentText | MCPContentResource;
interface MCPResult { content: MCPContent[]; isError?: boolean }
interface MCPResponse {
  jsonrpc: string;
  id?: number | string;
  result?: MCPResult;
  error?: { code: number; message: string };
}

interface MCPCallResult {
  status: number;
  sessionId: string | null;
  body: MCPResponse | null;
}

// Phase C: 老 `bearer` 参数现在是 createAPIToken 返的 JSON blob
// {keyId, privateKeyPem}。本 file 内部解 + Sigv1 签每个请求 (无 cookie
// 缓存)。spec 仍可继续 `callTool(req, apiToken, sid, ...)`，apiToken
// 现在是 opaque creds blob。
import { formatAuthHeader, signNow } from '@/fixtures/sigv1';

interface Creds { keyId: string; privateKeyPem: string }

function parseCreds(blob: string): Creds {
  try {
    const parsed = JSON.parse(blob) as Creds;
    if (!parsed.keyId || !parsed.privateKeyPem) {
      throw new Error('creds missing keyId / privateKeyPem');
    }
    return parsed;
  } catch (err) {
    throw new Error(`mcp creds: invalid blob — did you call createAPIToken first? (${String(err)})`);
  }
}

async function mcpCall(
  request: APIRequestContext,
  body: unknown,
  bearer: string,
  sessionId?: string,
): Promise<MCPCallResult> {
  const creds = parseCreds(bearer);
  const auth = formatAuthHeader(signNow(creds.privateKeyPem, creds.keyId));
  const headers: Record<string, string> = {
    Authorization: auth,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await request.post(`${BACKEND}/mcp`, { headers, data: body });
  return {
    status: res.status(),
    sessionId: res.headers()['mcp-session-id'] ?? null,
    body: parseMCPText(await res.text()),
  };
}

function parseMCPText(text: string): MCPResponse | null {
  if (text.trim().startsWith('{')) return JSON.parse(text) as MCPResponse;
  if (text.includes('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine) return JSON.parse(dataLine.slice(5).trim()) as MCPResponse;
  }
  return null;
}

export async function initMCP(request: APIRequestContext, bearer: string): Promise<string> {
  const init = await mcpCall(request, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    },
  }, bearer);
  if (!init.sessionId) throw new Error(`MCP init missing session id (status=${init.status})`);
  await mcpCall(request, {
    jsonrpc: '2.0', method: 'notifications/initialized',
  }, bearer, init.sessionId);
  return init.sessionId;
}

export async function callTool<T>(
  request: APIRequestContext,
  bearer: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await mcpCall(request, {
    jsonrpc: '2.0', id: nextID(), method: 'tools/call',
    params: { name, arguments: args },
  }, bearer, sessionId);
  if (res.status !== 200 || !res.body) {
    throw new Error(`tool ${name} status=${res.status}`);
  }
  if (res.body.error) {
    throw new Error(`tool ${name} error: ${res.body.error.message}`);
  }
  const content = res.body.result?.content?.[0];
  if (!content) throw new Error(`tool ${name} returned no content`);
  if (content.type !== 'text') {
    throw new Error(`tool ${name} returned non-text content (use callToolMulti)`);
  }
  // mcp-go 的 NewToolResultError 把 plaintext 包成 content.text；正常返成功
  // 时我们在 backend 里 marshal 一个 JSON 字符串进去。所以先看 isError 兜底，
  // 然后试 JSON.parse；parse 失败就当 plaintext 错误信息抛。
  if (res.body.result?.isError) {
    throw new Error(`tool ${name} error: ${content.text}`);
  }
  return parseOrThrow<T>(name, content.text);
}

function parseOrThrow<T>(name: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`tool ${name} non-JSON content: ${text}`);
  }
}

// callToolMulti —— like callTool but returns the full content array. Use this
// for tools that emit a text part + embedded binary (resume.draft / update_draft
// return [TextContent(JSON), EmbeddedResource(PDF blob base64)]).
export async function callToolMulti(
  request: APIRequestContext,
  bearer: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<MCPContent[]> {
  const res = await mcpCall(request, {
    jsonrpc: '2.0', id: nextID(), method: 'tools/call',
    params: { name, arguments: args },
  }, bearer, sessionId);
  if (res.status !== 200 || !res.body) {
    throw new Error(`tool ${name} status=${res.status}`);
  }
  if (res.body.error) {
    throw new Error(`tool ${name} error: ${res.body.error.message}`);
  }
  const content = res.body.result?.content;
  if (!content || content.length === 0) {
    throw new Error(`tool ${name} returned no content`);
  }
  if (res.body.result?.isError) {
    const first = content[0];
    const msg = first && first.type === 'text' ? first.text : '(no message)';
    throw new Error(`tool ${name} error: ${msg}`);
  }
  return content;
}

let _toolCallID = 100;
function nextID(): number {
  _toolCallID += 1;
  return _toolCallID;
}
