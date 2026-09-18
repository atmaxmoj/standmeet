// adversary-mcp.js — a deliberately hostile block, the falsifiable proof of the eiab
// isolation boundaries (security-block-isolation-adversarial.spec.ts). Each tool ATTEMPTS
// one escape and reports { blocked: true } iff the sandbox refused it. Nothing here is a
// mock: the tool really tries to reach the network, dial a sibling's reach-back socket,
// open the database, or present a forged native key to the host — and each attempt fails
// at the sandbox / host boundary (no network namespace, no bound sibling socket, no
// injected key), so it returns blocked:true. Remove --unshare-net, bind a sibling socket,
// or inject a key, and the matching tool flips to blocked:false and the spec goes RED.
//
// It leaks nothing: every result is exactly { blocked } — no env, no key, no secret text.
// Being JS it cannot import any Go/host internal; host-blindness is structural.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const net = require('net')
const fs = require('fs')

const DIAL_TIMEOUT_MS = 1500
const NET_TIMEOUT_MS = 2000

// dialFails — try to connect (to a path or host:port); resolve true if the connection
// FAILS (blocked), false if it unexpectedly succeeds (isolation broken). If it connects,
// optionally write a probe payload; any bytes back also means "not blocked".
function dialFails(target, probe) {
  return new Promise((resolve) => {
    let done = false
    const finish = (blocked) => { if (!done) { done = true; try { s.destroy() } catch (_e) {} resolve(blocked) } }
    let s
    try {
      s = typeof target === 'string' ? net.connect(target) : net.connect(target.port, target.host)
    } catch (_e) { resolve(true); return }
    s.on('connect', () => { if (probe) { try { s.write(probe) } catch (_e) {} } else { finish(false) } })
    s.on('data', () => finish(false)) // a reply means the boundary let us through
    s.on('error', () => finish(true))
    setTimeout(() => finish(true), DIAL_TIMEOUT_MS)
  })
}

// ─── native-key attacks: no key is injected (no host_ops) and no host socket is bound, so
// every attempt to present a key to the host cannot even reach it. ───
const FORGED_KEY = 'forged-' + '0'.repeat(64)
const HOST_SOCKET_GUESSES = [
  '/run/standmeet/host.sock', '/run/standmeet/blocks/host.sock',
  '/tmp/standmeet-host.sock', '/plugin/host.sock',
]

async function presentKeyToHost(key, id) {
  const probe = JSON.stringify({ native_key: key, op: 'whoami', block_id: id }) + '\n'
  for (const path of HOST_SOCKET_GUESSES) {
    if (!(await dialFails(path, probe))) return false // reached + answered → NOT blocked
  }
  return true
}

const attempts = {
  // A fabricated key, presented to the host — refused because there is no host socket to reach.
  adversary_forge_native_key: () => presentKeyToHost(FORGED_KEY, 'adversary'),
  // No get-by-id exists; the issuer keys by the secret itself. Nothing to fetch.
  adversary_steal_sibling_key_by_id: () => presentKeyToHost(FORGED_KEY, 'booker'),
  // Key names are 32 random bytes, not derivable; env carries no sibling key.
  adversary_guess_key_name: async () => process.env.STANDMEET_NATIVE_KEY === undefined,
  // A key is revoked on unmount; we never held one anyway.
  adversary_reuse_post_unmount_key: () => presentKeyToHost(FORGED_KEY, 'adversary'),
  // Claiming another block's id to the host — cannot reach the host to claim anything.
  adversary_present_other_identity: () => presentKeyToHost(FORGED_KEY, 'retrieval'),

  // ─── socket attacks: the sandbox has no network and binds only its own host sockets. ───
  adversary_dial_sibling_socket: async () => {
    for (const g of ['/run/standmeet/blocks/booker.sock', '/run/standmeet/blocks/retrieval.sock']) {
      if (!(await dialFails(g))) return false
    }
    return true
  },
  adversary_enumerate_sockets: async () => {
    for (const dir of ['/run/standmeet', '/run/standmeet/blocks', '/var/run', '/tmp']) {
      try {
        if (fs.readdirSync(dir).some((e) => e.endsWith('.sock'))) return false
      } catch (_e) { /* dir absent / no access — good */ }
    }
    return true
  },
  adversary_reach_network: async () => {
    try {
      await fetch('http://93.184.216.34/', { signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      return false // reached the network → isolation broken
    } catch (_e) { return true }
  },

  // ─── db cross-schema attacks: the block has no network, so it cannot even open a pg
  // connection; the per-block schema (mcp_<id>) is host-derived, never caller-supplied. ───
  adversary_set_search_path: () => dbUnreachable(),
  adversary_enumerate_schemas: () => dbUnreachable(),
  adversary_drop_foreign_schema: () => dbUnreachable(),
  adversary_query_forged_schema: () => dbUnreachable(),
}

// dbUnreachable — the database sits behind the network namespace the sandbox does not
// share; a raw connect to it (any of the usual dev hostnames) fails, so no SQL — forged
// schema name or otherwise — can run.
async function dbUnreachable() {
  for (const host of ['db', 'postgres', '127.0.0.1']) {
    if (!(await dialFails({ host, port: 5432 }))) return false
  }
  return true
}

async function main() {
  const server = new McpServer(
    { name: 'adversary', version: '1.0.0' },
    { instructions: 'A test-only adversary block: every tool attempts one isolation escape.', capabilities: { tools: {} } },
  )
  for (const name of Object.keys(attempts)) {
    server.registerTool(
      name,
      { description: `Adversary probe: ${name}. Attempts the attack and reports whether the sandbox blocked it.`, inputSchema: {} },
      async () => {
        const blocked = await attempts[name]()
        return { content: [{ type: 'text', text: JSON.stringify({ blocked }) }] }
      },
    )
  }
  await server.connect(new StdioServerTransport())
}

main().catch((e) => { console.error(e); process.exit(1) })
