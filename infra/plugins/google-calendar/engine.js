// engine.js — the generic openapi-runtime engine, shared by every openapi supplier block (a JS port
// of internal/infra/openapi). Given a supplier's spec + binding (in its plugin dir) and the owner's
// credentials merged into each call by the host, it exposes the SEAM's verbs as MCP tools and does
// the HTTP: translate the seam verb's args into the binding's contract input, render the request /
// query via the binding's JSONata, resolve the spec operation (method/path/baseURL), inject auth,
// fetch, then map the response JSONata output to the canonical wire shape booker consumes.
//
// It names no provider: google-calendar and any owner-uploaded SaaS are DATA this one engine loads.
// A supplier block is a two-line wrapper: `require('.../openapi/engine').serve(__dirname)`.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const YAML = require('yaml')
const jsonata = require('jsonata')

// ── the seam contract: seam → verb → {contract-method it binds through, arg translation (seam
// snake-case → the binding's camelCase contract input), canonical response shape}. This is seam
// knowledge (identical for every openapi supplier of the seam), not provider knowledge — the Go
// calendarAdapter/mailAdapter held exactly this, now generic in the block.
const nowISO = () => new Date().toISOString()
const randHex = () => crypto.randomBytes(16).toString('hex')

const SEAM = {
  calendar: {
    free_busy: {
      method: 'list_busy',
      input: (a) => ({ timeMin: a.time_min, timeMax: a.time_max }),
      canon: (r) => ({ busy: (r && r.busy) || [] }),
    },
    insert_event: {
      method: 'create_event',
      input: (a) => ({
        summary: a.summary, description: a.description, start: a.start, end: a.end,
        timeZone: a.time_zone, visitorEmail: a.visitor_email, idempotencyKey: randHex(),
      }),
      canon: (r) => ({ eventId: (r && r.id) || '', htmlLink: (r && r.htmlLink) || '' }),
    },
    delete_event: {
      method: 'cancel_event',
      input: (a) => ({ eventId: a.event_id, attendeeEmail: a.attendee_email }),
      canon: () => ({ ok: true }),
    },
    // verify — the connection test: a tiny free/busy read proves the token works (the calendar_check
    // pattern). Read-only, books nothing.
    verify: {
      method: 'list_busy',
      input: () => ({ timeMin: nowISO(), timeMax: nowISO() }),
      canon: () => ({ ok: true }),
    },
  },
  mail: {
    send: {
      method: 'send',
      input: (a) => ({ to: a.to, subject: a.subject, body: a.body, html: a.html }),
      canon: (r) => ({ id: (r && r.id) || '' }),
    },
  },
}

// conn — the credential fields the host merges in; declared optional so the MCP input schema does
// not strip them before the handler reads them for auth. bearer/oauth2 → access_token; apiKey →
// api_key (injected per the spec's security scheme). base_url lets the host override the spec's
// server (the block's baked spec cannot env-expand ${GOOGLE_CALENDAR_BASE}; the host, which can,
// merges the resolved target in — declared here so the schema does not strip it).
const CONN = {
  access_token: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
}

// per-verb declared arg fields (so booker's args survive schema validation alongside the creds).
const VERB_ARGS = {
  free_busy: { time_min: z.string().optional(), time_max: z.string().optional() },
  insert_event: {
    summary: z.string().optional(), description: z.string().optional(),
    start: z.string().optional(), end: z.string().optional(),
    time_zone: z.string().optional(), visitor_email: z.string().optional(),
  },
  delete_event: { event_id: z.string().optional(), attendee_email: z.string().optional() },
  verify: {},
  send: {
    to: z.string().optional(), subject: z.string().optional(),
    body: z.string().optional(), html: z.string().optional(),
  },
}

const asText = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })

// loadSupplier — read + parse spec.yaml and binding.yaml from the block's plugin dir, compile the
// binding's JSONata once, and index the spec's operations by operationId.
function loadSupplier(dir) {
  const spec = YAML.parse(fs.readFileSync(path.join(dir, 'spec.yaml'), 'utf8'))
  const binding = YAML.parse(fs.readFileSync(path.join(dir, 'binding.yaml'), 'utf8'))
  const ops = indexOps(spec) // operationId → { method, pathTemplate, bodyMedia }
  const baseURL = ((spec.servers && spec.servers[0] && spec.servers[0].url) || '').replace(/\/$/, '')
  return { spec, binding, ops, baseURL }
}

// indexOps — walk the spec's paths → methods, keyed by operationId (openapi 3.0/3.1 identical here).
function indexOps(spec) {
  const out = {}
  for (const [tmpl, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (op && op.operationId) {
        out[op.operationId] = { method: method.toUpperCase(), pathTemplate: tmpl, op }
      }
    }
  }
  return out
}

// compileExpr — jsonata source may be a scalar string or structured (the admin UI paste shape,
// JSON-serialized to an object-constructor). Returns a compiled expr or null.
function compileExpr(src) {
  if (src === undefined || src === null || src === '') return null
  const text = typeof src === 'string' ? src : JSON.stringify(src)
  return jsonata(text)
}

module.exports = { loadSupplier, indexOps, compileExpr, SEAM, CONN, VERB_ARGS, asText, serve }

// serve — stand up the MCP block for the supplier in `dir`: register the seam's bound verbs as
// tools, each running the full request path. (Execution helpers live in engine_call.js to keep this
// file within the line budget.)
async function serve(dir) {
  const sup = loadSupplier(dir)
  const verbs = SEAM[sup.binding.seam]
  if (!verbs) throw new Error(`openapi block: unknown seam ${sup.binding.seam}`)
  const { callVerb } = require('./engine_call.js')

  const server = new McpServer({ name: sup.spec?.info?.title || 'openapi', version: '1.0.0' })
  for (const [verb, contract] of Object.entries(verbs)) {
    // only register a verb whose contract method the binding actually maps (verify falls back to a
    // read the binding must have; a mail supplier maps only send).
    if (contract.method !== 'verify' && !sup.binding.operations?.[contract.method]) continue
    server.registerTool(
      verb,
      {
        description: `${sup.binding.seam} seam verb ${verb} (openapi-backed).`,
        inputSchema: { ...CONN, ...(VERB_ARGS[verb] || {}) },
      },
      async (args) => asText(await callVerb(sup, verb, contract, args)),
    )
  }
  await server.connect(new StdioServerTransport())
}
