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
  // 显式 timeout 覆盖 playwright actionTimeout 默认 10s —— sweep 模式
  // 372 spec 串跑时 MCP 路径 (sigv1 签名 + DB lookup + tool dispatch)
  // 偶尔会撞 10s 上限 (_render-sample-pdfs 在 sweep 时被踩过)。
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

// MCPToolDef —— tools/list 单条工具元数据(name + 可选描述/schema)。
// inputSchema 是 MCP 客户端据以填参的那份 —— 字段掉了,客户端就再也发不出那个参数。
export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown> };
}
interface MCPListResult { tools: MCPToolDef[] }

// listTools —— 真实 MCP 工具发现路径(tools/list)。这条路径会序列化**全部**
// 工具的 InputSchema —— 一个坏 schema 就让整张表 marshal 失败、返空 body、客户端
// 一个工具都发现不了。所以它是 owner MCP 能被真实客户端(Claude Desktop)用起来
// 的命门。返回工具名+元数据列表。
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

// ToolOutcome —— 一次 tools/call 的**协议层**结果,不因工具自己报错而抛。
//
// callTool 把 isError 当失败抛出,那是"我要这个工具成功"的用法。有另一类断言需要区分
// 两件完全不同的事:**工具被正常调用了但拒绝了入参**(健康:门在、依赖在、校验生效)
// vs **调用根本没打通**(传输错 / handler 未注册 / 依赖是 nil 直接 panic)。前者是绿,
// 后者是红,而 callTool 会把两者都变成 throw。
export interface ToolOutcome {
  status: number;
  reachable: boolean; // 拿到了合法的 JSON-RPC result(无论 ok 还是 isError)
  isError: boolean;
  text: string;
  rpcError: string; // 非空 = JSON-RPC 层错误(未知工具等)
}

// callToolOutcome —— 调一个工具,只报告"打通没打通",不对业务结果下判断。
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
