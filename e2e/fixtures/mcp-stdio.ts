// mcp-stdio.ts —— spawn @standmeet/mcp-client child process for e2e。
// 等价于 owner 在 Claude Desktop 启的 MCP server。每个 JSON-RPC 一行喂
// stdin，stdout 读响应一行。
//
// 区别于 e2e/fixtures/mcp.ts (直接 HTTP + Sigv1)：本 fixture 走 stdio
// 桥，验证 SDK 自己的代码路径 (creds load + sign + HTTP forward)。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// playwright 跑时 cwd = e2e/，相对解 sdk bin。`import.meta.dirname` 在
// playwright 把 .ts 编 CJS 时不可用 (no ESM meta)，cwd-relative 更稳。
const SDK_BIN = resolve(process.cwd(), '..', 'sdk/packages/mcp-client/bin/standmeet-mcp');

export interface StdioCreds { keyId: string; privateKeyPem: string }

export interface StdioMCPClient {
  call(method: string, params: unknown, id: number): Promise<unknown>;
  close(): void;
}

interface PendingResolve {
  resolve: (v: unknown) => void;
  reject: (err: Error) => void;
}

export async function spawnStdioMCP(creds: StdioCreds): Promise<StdioMCPClient> {
  const credsPath = await writeCredsFile(creds);
  const child = spawnSDK(credsPath);
  const pending = new Map<number, PendingResolve>();
  wireStdout(child, pending);
  wireStderr(child);
  await initialize(child);
  return {
    call: (method, params, id) => callRPC(child, pending, method, params, id),
    close: () => { child.stdin.end(); child.kill(); },
  };
}

async function writeCredsFile(creds: StdioCreds): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'standmeet-mcp-'));
  const path = join(dir, 'credentials.json');
  await writeFile(path, JSON.stringify(creds), { mode: 0o600 });
  return path;
}

function spawnSDK(credsPath: string): ChildProcessWithoutNullStreams {
  return spawn('node', [SDK_BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      STANDMEET_HOST: BACKEND,
      STANDMEET_CREDS_PATH: credsPath,
    },
  });
}

interface JSONRPCMessage { id?: number; result?: unknown; error?: { message: string } }

function wireStdout(
  child: ChildProcessWithoutNullStreams,
  pending: Map<number, PendingResolve>,
): void {
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) dispatchLine(line, pending);
  });
}

function wireStderr(child: ChildProcessWithoutNullStreams): void {
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    process.stderr.write(`[stdio-mcp] ${chunk}`);
  });
}

function dispatchLine(line: string, pending: Map<number, PendingResolve>): void {
  if (line.trim() === '') return;
  try {
    const msg = JSON.parse(line) as JSONRPCMessage;
    if (typeof msg.id !== 'number') return; // notification or unrelated
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  } catch (err) {
    process.stderr.write(`[stdio-mcp] parse error: ${String(err)} line=${line}\n`);
  }
}

async function initialize(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'e2e-stdio', version: '1' },
    },
  }) + '\n');
  // wait for init reply line then send notifications/initialized
  await waitOneLine(child);
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', method: 'notifications/initialized',
  }) + '\n');
}

async function waitOneLine(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolveFn, rejectFn) => {
    const onData = () => { child.stdout.off('data', onData); resolveFn(); };
    child.stdout.on('data', onData);
    setTimeout(() => { child.stdout.off('data', onData); rejectFn(new Error('init timeout')); }, 5_000);
  });
}

async function callRPC(
  child: ChildProcessWithoutNullStreams,
  pending: Map<number, PendingResolve>,
  method: string, params: unknown, id: number,
): Promise<unknown> {
  return await new Promise((resolveFn, rejectFn) => {
    pending.set(id, { resolve: resolveFn, reject: rejectFn });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id, method, params,
    }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rejectFn(new Error(`rpc ${method} timeout`));
      }
    }, 10_000);
  });
}
