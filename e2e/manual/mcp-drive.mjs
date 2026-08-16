// mcp-drive.mjs —— 用**产品自己的** stdio MCP 客户端跑几个 owner 工具。
// 不手搓 Sigv1 签名器（[[c3-stdio-sdk-sigv1-401]]）：起 bin/standmeet-mcp，走 JSON-RPC over stdio。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CLIENT = process.argv[2];
const HOST = process.argv[3];
const CREDS = process.argv[4];
// `@path` —— 从文件读那段 JSON。命令行那一版把整个 JSON 包在**单引号**里，
// 于是任何一个撇号（`the agent's reach`）都会当场把 shell 的引号断掉 ——
// 报出来的是 `unexpected EOF`，看起来像用法写错了。而 owner 真正要发的
// 载荷（一封求职信）里必然有撇号。
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
  // 打印上限可调（`MCP_PRINT=0` = 不截）。**截断必须说出来**：默认那 4000 字符会把一份
  // JSON 从中间切开，切口长得就像服务端发了半截回执 —— 我差点把自己的显示上限当成产品缺陷。
  printCapped(JSON.stringify(content, null, 1));
}
proc.kill();

// printCapped —— 按 `MCP_PRINT`（字符数，0 = 不截）打印，截了就在末尾说清楚截了多少。
function printCapped(text) {
  const cap = Number(process.env.MCP_PRINT ?? 4000);
  if (cap === 0 || text.length <= cap) {
    console.log(text);
    return;
  }
  console.log(text.slice(0, cap));
  console.log(`… [truncated by MCP_PRINT=${cap}; ${text.length - cap} more chars]`);
}
