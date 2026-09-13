// koishi-mcp.js — a stdio-MCP server whose tools are computed by a REAL third-party
// Koishi plugin running headlessly. This is the "works-today piggyback" proof: a plugin
// written for a different ecosystem (Koishi, a chatbot framework) is wrapped as an MCP
// server and used by a StandMeet visitor agent, unmodified.
//
// How it works: we boot Koishi core with @koishijs/plugin-mock (an in-memory adapter that
// lets us drive commands headlessly, no chat platform) and load koishi-plugin-base64. Each
// MCP tool call is turned into the plugin's own command ("base64.编码 <text>") and executed
// through the mock client; the string the plugin computes and replies with is returned
// verbatim as the tool result. Nothing here reimplements base64 — the answer is whatever the
// Koishi plugin produces, so a correct result proves the real plugin ran.
//
// CREDIT: koishi-plugin-base64 is authored by **windbullet** (MIT). We wrap it unchanged.
//   https://www.npmjs.com/package/koishi-plugin-base64
//   Koishi framework: https://koishi.chat  (@koishijs/plugin-mock, koishi core — MIT)
// See infra/plugins/koishi/CREDITS and docs/design/plugin/everything-is-a-block.md.

const { Context } = require('koishi')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

// Koishi plugins are TS-compiled and export either `default` or a namespace with `apply`;
// `m.default ?? m` unwraps both shapes.
const load = (m) => m.default ?? m
const mock = load(require('@koishijs/plugin-mock'))
const memory = load(require('@koishijs/plugin-database-memory'))
const base64 = load(require('koishi-plugin-base64'))

// Boot Koishi once and reuse the app + mock client across tool calls (a stdio server is
// long-lived). initUser gives our synthetic caller authority so no command gate blocks it.
let ready
async function boot() {
  const app = new Context()
  app.plugin(memory) // in-memory DB: lets initUser set authority (insurance, no external store)
  app.plugin(mock) // adds the app.mock headless adapter
  app.plugin(base64) // the third-party plugin under test: registers base64.编码 / base64.解码
  await app.start() // commands + adapter are not live until start resolves
  await app.mock.initUser('u1', 4)
  return app.mock.client('u1')
}

// koishi — run one Koishi command through the mock client and return the reply text. The
// mock captures each session.send(); base64 replies once, so join is a single line.
async function koishi(text) {
  ready ??= boot()
  const client = await ready
  const replies = await client.receive(text)
  return replies.join('\n')
}

async function main() {
  const server = new McpServer({ name: 'koishi-base64', version: '1.0.0' })
  server.registerTool(
    'base64_encode',
    {
      description: 'Base64-encode text. Computed by the Koishi plugin koishi-plugin-base64.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: 'text', text: await koishi(`base64.编码 ${text}`) }] }),
  )
  server.registerTool(
    'base64_decode',
    {
      description: 'Base64-decode text. Computed by the Koishi plugin koishi-plugin-base64.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: 'text', text: await koishi(`base64.解码 ${text}`) }] }),
  )
  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
