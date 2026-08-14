// mcp-drive.mjs —— 用**产品自己的** stdio MCP 客户端跑几个 owner 工具。
// 不手搓 Sigv1 签名器（[[c3-stdio-sdk-sigv1-401]]）：起 bin/standmeet-mcp，走 JSON-RPC over stdio。
import { spawn } from 'node:child_process';

const CLIENT = process.argv[2];
const HOST = process.argv[3];
const CREDS = process.argv[4];
const CALLS = JSON.parse(process.argv[5]);

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
  console.log(JSON.stringify(content, null, 1).slice(0, 4000));
}
proc.kill();
