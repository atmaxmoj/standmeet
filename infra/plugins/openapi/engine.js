// engine.js — the generic openapi-runtime engine, the one place an openapi supplier's HTTP runs
// (it replaced the in-host internal/infra/openapi runtime). Given a supplier's spec + binding and
// the auth the host resolved, it exposes the SEAM's verbs as MCP tools and does the HTTP:
// translate the seam verb's args into the binding's contract input, render the request / query via
// the binding's JSONata, resolve the spec operation (method/path/baseURL/body media), apply the
// host's auth headers/query, fetch through the egress guard, then map the response JSONata output
// to the canonical wire shape the seam consumes.
//
// It names no provider. Two ways to load a supplier:
//   - a block that ships its own spec.yaml + binding.yaml (google-calendar) reads them once from
//     its dir;
//   - the shared openapi block (no spec.yaml in its dir) reads `spec` and `binding` from each
//     call's args — the host merges an owner-uploaded supplier's definition into every call.
// A supplier block is a two-line wrapper: `require('./engine.js').serve(__dirname)`.
//
// This file is vendored verbatim into infra/plugins/google-calendar (the sandbox binds only a
// block's own dir); engine.test.js fails if the two copies differ.

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
// knowledge (identical for every openapi supplier of the seam), not provider knowledge. A verb
// marked `local` makes no HTTP call.
const nowISO = () => new Date().toISOString()
const randHex = () => crypto.randomBytes(16).toString('hex')
const str = (v) => (typeof v === 'string' ? v : '')

const SEAM = {
  calendar: {
    free_busy: {
      method: 'list_busy',
      input: (a) => ({ timeMin: a.time_min, timeMax: a.time_max }),
      canon: (r) => ({ busy: busyRows(r && r.busy) }),
    },
    insert_event: {
      method: 'create_event',
      input: (a) => ({
        summary: a.summary, description: a.description, start: a.start, end: a.end,
        timeZone: a.time_zone, visitorEmail: a.visitor_email, idempotencyKey: randHex(),
      }),
      // invited — whether the calendar itself mailed the attendee (the binding says so); a
      // binding that does not say means it did not. A field of the wrong shape reads as empty,
      // never as garbage handed to the consumer.
      canon: (r) => ({ eventId: str(r && r.id), htmlLink: str(r && r.htmlLink), invited: (r && r.invited) === true }),
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
      canon: (r) => ({ id: str(r && r.id) }),
    },
    // verify — an HTTP mail API has nothing to dial without sending: saving the key is what makes
    // it usable, so the connection test passes without a call.
    verify: { local: true, canon: () => ({ ok: true }) },
  },
}

// busyRows — the canonical busy list: only rows with string start/end survive.
function busyRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter((b) => b && typeof b.start === 'string' && typeof b.end === 'string')
    .map((b) => ({ start: b.start, end: b.end }))
}

// CONN — what the host merges into every call; declared so the MCP input schema does not strip it.
//   auth_headers / auth_query — the owner's auth, resolved host-side from the spec's scheme
//     (bearer, api key, basic, oauth token). The engine applies them and knows no scheme.
//   base_url — overrides the spec's first server (the host env-expands it; a baked spec cannot).
//   allow_hosts — internal host names the owner allowed (/admin/system); every other internal
//     address is refused at dial time.
//   spec / binding — an uploaded supplier's definition (raw YAML or JSON text).
const CONN = {
  auth_headers: z.record(z.string()).optional(),
  auth_query: z.record(z.string()).optional(),
  base_url: z.string().optional(),
  allow_hosts: z.array(z.string()).optional(),
  spec: z.string().optional(),
  binding: z.string().optional(),
}

// per-verb declared arg fields (so the seam's args survive schema validation alongside CONN).
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
  // raw_call — an agent tool: one spec operation by operationId, args as its body/path params.
  raw_call: { op_id: z.string(), args: z.any().optional() },
}

const asText = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })

// loadSupplier — read spec.yaml and binding.yaml from a block's own dir.
function loadSupplier(dir) {
  return parseSupplier(
    fs.readFileSync(path.join(dir, 'spec.yaml'), 'utf8'),
    fs.readFileSync(path.join(dir, 'binding.yaml'), 'utf8'),
  )
}

// parseSupplier — spec + binding text (YAML or JSON) → the engine's view. An agent-only supplier
// has no binding.
function parseSupplier(specText, bindingText) {
  const spec = YAML.parse(specText)
  const binding = bindingText ? YAML.parse(bindingText) : null
  const baseURL = ((spec.servers && spec.servers[0] && spec.servers[0].url) || '').replace(/\/$/, '')
  return { spec, binding, ops: indexOps(spec), baseURL }
}

// indexOps — operationId → { method, pathTemplate, media, required }. media is the request body's
// declared media type (JSON first, else the lexicographically smallest, '' = no body declared);
// required is that media's schema.required — the pre-flight list.
function indexOps(spec) {
  const out = {}
  for (const [tmpl, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods || {})) {
      if (op && op.operationId) {
        const { media, required } = pickBodyMedia(op.requestBody && op.requestBody.content)
        out[op.operationId] = { method: method.toUpperCase(), pathTemplate: tmpl, op, media, required }
      }
    }
  }
  return out
}

function pickBodyMedia(content) {
  if (!content || typeof content !== 'object') return { media: '', required: [] }
  const names = Object.keys(content).sort()
  const media = content['application/json'] ? 'application/json' : (names[0] || '')
  const schema = (media && content[media] && content[media].schema) || {}
  return { media, required: Array.isArray(schema.required) ? schema.required : [] }
}

// compileExpr — jsonata source may be a scalar string or structured (the admin UI paste shape,
// JSON-serialized to an object-constructor). Returns a compiled expr or null.
function compileExpr(src) {
  if (src === undefined || src === null || src === '') return null
  const text = typeof src === 'string' ? src : JSON.stringify(src)
  return jsonata(text)
}

module.exports = {
  loadSupplier, parseSupplier, indexOps, compileExpr, SEAM, CONN, VERB_ARGS, asText, serve,
}

// serve — stand up the MCP block for the supplier in `dir`. With a spec.yaml there, the supplier is
// fixed and only its seam's bound verbs are tools. Without one (the shared openapi block), every
// seam verb plus raw_call is a tool, and each call brings its own spec + binding.
async function serve(dir) {
  const { callVerb, callRaw } = require('./engine_call.js')
  const fixed = fs.existsSync(path.join(dir, 'spec.yaml')) ? loadSupplier(dir) : null
  const server = new McpServer({ name: (fixed && fixed.spec?.info?.title) || 'openapi', version: '1.0.0' })
  const register = (verb, run) => server.registerTool(
    verb,
    { description: `openapi seam verb ${verb}.`, inputSchema: { ...CONN, ...(VERB_ARGS[verb] || {}) } },
    async (args) => asText(await run(fixed || parseSupplier(args.spec, args.binding), args)),
  )
  for (const verb of toolVerbs(fixed)) {
    register(verb, (sup, args) => callVerb(sup, verb, contractFor(sup, verb), args))
  }
  if (!fixed) register('raw_call', (sup, args) => callRaw(sup, args))
  await server.connect(new StdioServerTransport())
}

// toolVerbs — a fixed supplier: its seam's verbs whose contract method the binding maps (verify
// borrows a read the binding must have). The shared block: the union of every seam's verbs.
function toolVerbs(fixed) {
  if (!fixed) return [...new Set(Object.values(SEAM).flatMap((v) => Object.keys(v)))]
  const verbs = SEAM[fixed.binding.seam]
  if (!verbs) throw new Error(`openapi block: unknown seam ${fixed.binding.seam}`)
  return Object.entries(verbs)
    .filter(([, c]) => c.local || fixed.binding.operations?.[c.method])
    .map(([verb]) => verb)
}

// contractFor — the seam contract for one verb of this supplier's binding.
function contractFor(sup, verb) {
  const seam = sup.binding && sup.binding.seam
  const contract = SEAM[seam] && SEAM[seam][verb]
  if (!contract) throw new Error(`openapi block: the ${seam || 'unbound'} supplier has no verb ${verb}`)
  return contract
}
