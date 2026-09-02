// mcp-drive.mjs —— runs a few owner tools with **the product's own** stdio MCP client.
// No hand-rolled Sigv1 signer ([[c3-stdio-sdk-sigv1-401]]): spins up bin/standmeet-mcp, JSON-RPC over stdio.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CLIENT = process.argv[2];
const HOST = process.argv[3];
const CREDS = process.argv[4];
// `@path` —— reads that JSON from a file. The command-line version wraps the whole JSON in
// **single quotes**, so any apostrophe (`the agent's reach`) breaks the shell's quoting on the
// spot — the error that comes out is `unexpected EOF`, which looks like a usage mistake. And a
// payload the owner would actually send (a cover letter) is bound to have an apostrophe in it.
const CALLS = JSON.parse(
  process.argv[5].startsWith('@') ? readFileSync(process.argv[5].slice(1), 'utf8') : process.argv[5],
);

const proc = spawn('node', [CLIENT], {
  env: { ...process.env, STANDMEET_HOST: HOST, STANDMEET_CREDS_PATH: CREDS },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line === '') continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg); }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'verify-driver', version: '0' },
});
console.log('# initialize:', JSON.stringify(init.result?.serverInfo ?? init.error));
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

for (const call of CALLS) {
  const out = await rpc('tools/call', { name: call.name, arguments: call.args ?? {} });
  const content = out.result?.content ?? out.error;
  console.log(`\n=== ${call.name} ${JSON.stringify(call.args ?? {})}`);
  saveBlobs(content, call.name);
  // The print cap is adjustable (`MCP_PRINT=0` = no truncation). **Truncation must be said
  // out loud**: the default 4000-char cap cuts a JSON payload in the middle, and the cut edge
  // looks exactly like the server sent back half a receipt — I nearly mistook my own display
  // cap for a product bug.
  printCapped(JSON.stringify(content, null, 1));
}
proc.kill();

// saveBlobs —— when `MCP_SAVE_BLOBS=<dir>` is set, writes attachments embedded in the response
// out to files.
//
// Why it's needed: some ops' output **exists only in the receipt** (`applications.commit`'s PDF
// is one — the download button in the admin UI is disabled there, titled pdfNotKept). The owner's
// real MCP client hands the attachment straight over, but this driver used to just print it as
// one giant base64 blob. The actual paper meant to be printed is buried in there.
function saveBlobs(content, callName) {
  const dir = process.env.MCP_SAVE_BLOBS;
  if (!dir || !Array.isArray(content)) return;
  content.forEach((part, i) => {
    const res = part?.resource;
    if (typeof res?.blob !== 'string') return;
    const ext = String(res.mimeType ?? '').includes('pdf') ? 'pdf' : 'bin';
    const path = `${dir}/${callName}-${i}.${ext}`;
    writeFileSync(path, Buffer.from(res.blob, 'base64'));
    console.log(`# saved ${path} (${res.mimeType ?? 'unknown'}, ${res.blob.length} b64 chars)`);
  });
}

// printCapped —— prints up to `MCP_PRINT` (character count, 0 = no cap), and if it truncated, says exactly how much at the end.
function printCapped(text) {
  const cap = Number(process.env.MCP_PRINT ?? 4000);
  if (cap === 0 || text.length <= cap) {
    console.log(text);
    return;
  }
  console.log(text.slice(0, cap));
  console.log(`… [truncated by MCP_PRINT=${cap}; ${text.length - cap} more chars]`);
}
