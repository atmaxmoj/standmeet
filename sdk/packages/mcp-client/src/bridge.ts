// bridge.ts —— stdio JSON-RPC ↔ streamable HTTP forwarder.
//
// Claude Desktop / Cursor spawn this process and talk to it over stdio
// JSON-RPC. Each stdin line is a JSON-RPC message → POST to backend /mcp
// (with Sigv1 sig + Mcp-Session-Id) → parse the response (JSON or SSE
// data:) → write one line of JSON back to stdout.
//
// Design: keep session_id across requests; all other state (including the
// sig) is stateless.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';

import { classifySkew } from '@standmeet/sdk-core';

import type { Creds } from './creds.js';
import { signAuthHeader } from './sigv1.js';

export interface BridgeOptions {
  host: string;
  creds: Creds;
  clientVersion: string; // this client's own version, for the version-skew advisory (Q5)
}

export async function runBridge(opts: BridgeOptions): Promise<void> {
  let sessionId: string | undefined;
  let advised = false; // the skew advisory is written to stderr at most once per session
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // update_self is a CLIENT tool (it npm-installs on the owner's machine) — the server can't run
    // it, so the bridge answers it here and never forwards.
    const local = await handleUpdateSelf(opts, trimmed);
    if (local !== null) { process.stdout.write(local + '\n'); continue; }
    const result = await forward(opts, await expandVaultImport(trimmed), sessionId);
    if (result.sessionId) sessionId = result.sessionId;
    if (result.body) {
      // The server can't advertise update_self either — inject it into tools/list.
      const body = injectUpdateSelfTool(trimmed, result.body);
      if (!advised) advised = adviseSkew(opts.clientVersion, body);
      process.stdout.write(body + '\n');
    }
  }
}

// adviseSkew —— if this response is the `initialize` result, compare the instance's version to this
// client's and, on a mismatch, write ONE advisory to stderr (MCP clients surface stderr in their
// logs). stdout stays the clean JSON-RPC channel. Returns true once it has advised (or determined
// there's nothing to say from a real initialize result), so it runs once. Parse failures → not yet.
function adviseSkew(clientVersion: string, body: string): boolean {
  let info: { version?: string; minCompatibleClient?: string } | undefined;
  try {
    const msg = JSON.parse(body) as { result?: { serverInfo?: typeof info } };
    info = msg.result?.serverInfo;
  } catch {
    return false;
  }
  if (info?.version === undefined) return false; // not the initialize result — keep looking
  const skew = classifySkew(clientVersion, info.version, info.minCompatibleClient ?? '');
  if (skew.verdict !== 'ok') process.stderr.write(`[standmeet-mcp] ${skew.message}\n`);
  return true;
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

// —— obsidian.import: accept a directory ————————————————————————————————
//
// The backend op takes files=[{path,content}] because a remote server can't read the caller's
// disk — the admin folder-upload leans on the *browser* to read the picked folder. That left the
// MCP twin unusable for an AI client, which can't materialize a whole vault into one tool call.
// This bridge DOES run on the owner's machine, so it closes the gap: an obsidian import call that
// carries a `path` (the vault root) is expanded HERE into the files array the backend expects, so
// `obsidian_import({ path })` is a real twin of picking the folder in /admin. A call that already
// carries `files` passes through untouched.
interface RpcCall {
  id?: number | string;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

async function expandVaultImport(line: string): Promise<string> {
  let msg: RpcCall;
  try {
    msg = JSON.parse(line) as RpcCall;
  } catch {
    return line;
  }
  if (msg.method !== 'tools/call') return line;
  const name = msg.params?.name;
  if (name !== 'obsidian_import' && name !== 'obsidian.import') return line;
  const args = msg.params?.arguments ?? {};
  const path = typeof args['path'] === 'string' ? args['path'] : '';
  const hasFiles = Array.isArray(args['files']) && args['files'].length > 0;
  if (path === '' || hasFiles) return line; // already the files form, or nothing to expand
  try {
    const files = await readVaultMarkdown(expandTilde(path));
    msg.params!.arguments = { files, authoritative: args['authoritative'] === true };
    return JSON.stringify(msg);
  } catch (err) {
    process.stderr.write(
      `[standmeet-mcp] obsidian_import: cannot read vault at ${path}: ${String(err)}\n`,
    );
    return line; // let the backend answer (it will report the missing files)
  }
}

// readVaultMarkdown — walk a vault root and return every markdown note as { path, content }, path
// RELATIVE TO THE ROOT so its top folder is the genre (wiki / raw / output / …) the backend
// reconciles by. Dot-directories (.obsidian, .git, .trash, .scripts) are skipped, and only .md is
// read — a binary asset can't ride a JSON string, and assets have their own upload path.
async function readVaultMarkdown(
  root: string,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      out.push({ path: relative(root, full), content: await readFile(full, 'utf8') });
    }
  }
  await walk(root);
  return out;
}

// expandTilde — resolve a leading ~ to the home directory (the owner types "~/vault", not an
// absolute path). Only a leading ~ is expanded; the rest is left to the OS.
function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

// —— update_self: the client updates ITSELF from the connected instance ——————————————
//
// The instance can neither advertise nor run this — it can't npm-install on the owner's machine. So
// the bridge injects the tool into tools/list and handles the call locally: download the pinned
// client tarball the instance serves at /api/mcp-package (Sigv1-signed, same as every forward),
// `npm i -g` it, reply, then self-exit ~250ms later so the MCP client respawns with the new binary.
// Mirrors youteacher_mcp/src/tools/updateSelf.ts. See docs/design/mcp-self-update.md.

const UPDATE_SELF_TOOL = {
  name: 'update_self',
  description:
    'Update THIS StandMeet MCP client to the version pinned by the connected instance: download its '
    + 'client package from /api/mcp-package and reinstall it globally via `npm i -g`. The running '
    + 'process exits ~250ms after replying; the MCP client respawns it with the new binary on the '
    + 'next tool call. Requires `npm` on PATH and a writable npm global prefix. Tell the user the '
    + 'version changed in your reply.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

// injectUpdateSelfTool — add update_self to a tools/list RESPONSE (the server can't advertise it).
function injectUpdateSelfTool(reqLine: string, respBody: string): string {
  let req: RpcCall;
  try { req = JSON.parse(reqLine) as RpcCall; } catch { return respBody; }
  if (req.method !== 'tools/list') return respBody;
  let resp: { result?: { tools?: unknown[] } };
  try { resp = JSON.parse(respBody) as typeof resp; } catch { return respBody; }
  const tools = resp.result?.tools;
  if (!Array.isArray(tools)) return respBody;
  if (tools.some((t) => (t as { name?: string }).name === 'update_self')) return respBody;
  tools.push(UPDATE_SELF_TOOL);
  return JSON.stringify(resp);
}

// handleUpdateSelf — if the line is a tools/call for update_self, do the update locally and return
// the JSON-RPC response string; otherwise return null so the caller forwards as usual.
async function handleUpdateSelf(opts: BridgeOptions, line: string): Promise<string | null> {
  let msg: RpcCall;
  try { msg = JSON.parse(line) as RpcCall; } catch { return null; }
  if (msg.method !== 'tools/call' || msg.params?.name !== 'update_self') return null;
  const id = msg.id ?? null;
  try {
    const res = await fetch(`${opts.host}/api/mcp-package`, {
      headers: { Authorization: signAuthHeader(opts.creds) },
    });
    if (!res.ok) return toolError(id, `GET /api/mcp-package → HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const cacheDir = join(homedir(), '.standmeet', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const tgz = join(cacheDir, 'standmeet-mcp-client-latest.tgz');
    writeFileSync(tgz, bytes);
    const npm = spawnSync('npm', ['i', '-g', tgz], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (npm.status !== 0) return toolError(id, `npm i -g exited ${String(npm.status)}\n${npm.stderr}`);
    // Let the reply flush before the process exits, so the client sees success then respawns.
    setTimeout(() => process.exit(0), 250);
    return JSON.stringify({
      jsonrpc: '2.0', id,
      result: { content: [{
        type: 'text',
        text: `StandMeet MCP client installed from /api/mcp-package (${String(bytes.byteLength)} bytes). `
          + `The running process (v${opts.clientVersion || 'unknown'}) exits in ~250ms; the MCP client `
          + 'respawns it with the new binary on the next tool call. If a call right now says "server '
          + 'not running", try again.',
      }] },
    });
  } catch (err) {
    return toolError(id, `update_self failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function toolError(id: number | string | null, text: string): string {
  return JSON.stringify({
    jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true },
  });
}
