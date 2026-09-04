// mcp.ts —— MCP streamable-HTTP client helper (shared across specs).
//
// initMCP: fires initialize + notifications/initialized back-to-back, returns the
// session-id. callTool: wraps tools/call and returns the parsed result text
// directly (typed JSON).
//
// Handles both the SSE and JSON response modes; the session-id header is
// maintained automatically.

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

// Phase C: the old `bearer` parameter is now the JSON blob returned by
// createAPIToken, {keyId, privateKeyPem}. This file internally parses + Sigv1-signs
// each request (no cookie cache). Specs can still call
// `callTool(req, apiToken, sid, ...)`; apiToken is now an opaque creds blob.
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
  // Explicit timeout overrides playwright's default 10s actionTimeout —— in sweep
  // mode, with 372 specs running serially, the MCP path (sigv1 signing + DB lookup
  // + tool dispatch) occasionally hits the 10s ceiling (_render-sample-pdfs was
  // caught by it during a sweep).
  const res = await request.post(`${BACKEND}/mcp`, {
    headers, data: body, timeout: 30_000,
  });
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

// MCPToolDef —— one tool's metadata from tools/list (name + optional
// description/schema). inputSchema is what the MCP client fills its args from —— if
// a field drops, the client can never send that parameter again.
export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown> };
}
interface MCPListResult { tools: MCPToolDef[] }

// listTools —— the real MCP tool-discovery path (tools/list). This path serializes
// the InputSchema of **every** tool —— one bad schema makes the whole table fail to
// marshal, returns an empty body, and the client discovers no tools at all. So it's
// the lifeline for whether owner MCP can be used by a real client (Claude Desktop).
// Returns the list of tool names + metadata.
export async function listTools(
  request: APIRequestContext,
  bearer: string,
  sessionId: string,
): Promise<MCPToolDef[]> {
  const res = await mcpCall(request, {
    jsonrpc: '2.0', id: nextID(), method: 'tools/list', params: {},
  }, bearer, sessionId);
  if (res.status !== 200 || !res.body) {
    throw new Error(`tools/list status=${res.status}`);
  }
  if (res.body.error) {
    throw new Error(`tools/list error: ${res.body.error.message}`);
  }
  const result = res.body.result as unknown as MCPListResult | undefined;
  if (!result?.tools) throw new Error('tools/list returned no tools array (empty body?)');
  return result.tools;
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
  // mcp-go's NewToolResultError wraps plaintext into content.text; on a normal
  // success the backend marshals a JSON string into it. So check isError first as a
  // fallback, then try JSON.parse; if the parse fails, throw it as a plaintext error message.
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

// ToolOutcome —— the **protocol-layer** result of one tools/call, which doesn't
// throw just because the tool itself reported an error.
//
// callTool throws on isError, which is the "I want this tool to succeed" usage.
// Another class of assertion needs to distinguish two completely different things:
// **the tool was called normally but rejected the args** (healthy: the door is
// there, the dependency is there, validation is in effect) vs **the call never got
// through** (transport error / handler not registered / a nil dependency panics
// outright). The former is green, the latter is red, and callTool turns both into a throw.
export interface ToolOutcome {
  status: number;
  reachable: boolean; // got a valid JSON-RPC result (whether ok or isError)
  isError: boolean;
  text: string;
  rpcError: string; // non-empty = a JSON-RPC-layer error (unknown tool etc.)
}

// callToolOutcome —— call a tool and report only "got through or not", passing no
// judgement on the business result.
export async function callToolOutcome(
  request: APIRequestContext,
  bearer: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const res = await mcpCall(request, {
    jsonrpc: '2.0', id: nextID(), method: 'tools/call',
    params: { name, arguments: args },
  }, bearer, sessionId);
  const rpcError = res.body?.error?.message ?? '';
  const content = res.body?.result?.content?.[0];
  return {
    status: res.status,
    reachable: res.status === 200 && res.body?.result !== undefined,
    isError: res.body?.result?.isError === true,
    text: content?.type === 'text' ? content.text : '',
    rpcError,
  };
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
