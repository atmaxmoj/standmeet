// koishi-mcp.js — wraps the CalDAV Koishi plugin (caldav-plugin.js) as a stdio-MCP block, the
// same shape infra/plugins/koishi uses for koishi-plugin-base64.
//
// It boots Koishi core with the CalDAV plugin (which provides `ctx.caldav` and does its WebDAV over
// the runtime's global fetch — no injected service), then exposes the four calendar-seam operations
// as MCP tools. The WebDAV + iCalendar work is done by the Koishi plugin + ical.js — nothing here
// (and no Go) reimplements CalDAV; a correct result proves the real plugin ran.
//
// The connection (url/username/password) is passed per call by the caller: the substrate resolves
// the owner's stored CalDAV credentials and hands them in when it dispatches the calendar seam. The
// block holds no credentials.

const { Context } = require('koishi')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const caldav = require('./caldav-plugin.js')

// Boot Koishi once; a stdio server is long-lived, so reuse the app + its `caldav` service.
let ready
async function boot() {
  const app = new Context()
  app.plugin(caldav) // the block: provides ctx.caldav, does WebDAV over global fetch + parses via ical.js
  await app.start() // services are not live until start resolves
  return app
}
async function svc() {
  ready ??= boot()
  return (await ready).caldav
}

// conn — the credential shape every op carries (host-supplied, not LLM-chosen).
const conn = {
  url: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
}
const only = (a) => ({ url: a.url, username: a.username, password: a.password })
const asText = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })

async function main() {
  const server = new McpServer({ name: 'caldav', version: '1.0.0' })

  server.registerTool(
    'verify',
    { description: 'CalDAV connection test (PROPFIND). Throws if the collection is unreachable.', inputSchema: conn },
    async (a) => asText(await (await svc()).verify(only(a))),
  )

  server.registerTool(
    'free_busy',
    {
      description: 'CalDAV free-busy-query → busy [start,end] intervals (RFC3339) within a range.',
      inputSchema: { ...conn, time_min: z.string(), time_max: z.string() },
    },
    async (a) => asText(await (await svc()).freeBusy(only(a), a.time_min, a.time_max)),
  )

  server.registerTool(
    'insert_event',
    {
      description: 'Create a meeting: PUT a VEVENT. Returns { eventId, htmlLink }.',
      inputSchema: {
        ...conn,
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        visitor_email: z.string().optional(),
      },
    },
    async (a) =>
      asText(await (await svc()).insertEvent(only(a), {
        summary: a.summary, start: a.start, end: a.end, visitorEmail: a.visitor_email,
      })),
  )

  server.registerTool(
    'delete_event',
    { description: 'Cancel a meeting: DELETE its .ics by event id.', inputSchema: { ...conn, event_id: z.string() } },
    async (a) => asText(await (await svc()).deleteEvent(only(a), a.event_id)),
  )

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
