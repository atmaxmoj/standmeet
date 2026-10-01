// engine_call.js — one openapi call: translate → render request/query (JSONata) → pre-flight the
// required fields → encode by the spec's media type → apply the host's auth → fetch through the
// egress guard → classify status → map response (JSONata) → canonical shape. The execution half
// of engine.js (split for the line budget).

const dns = require('dns')
const http = require('http')
const https = require('https')
const net = require('net')

const { compileExpr } = require('./engine.js')

const MAX_RESPONSE_BYTES = 4 << 20
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 30_000

// io — the network hand, swappable so a unit test can stand in for the SaaS.
const io = { fetch: guardedFetch }

// callVerb — run one seam verb end to end, returning the canonical wire object the seam consumes.
async function callVerb(sup, verb, contract, args) {
  if (contract.local) return contract.canon({})
  const input = contract.input(args) // seam snake args → the binding's camelCase contract input
  const bind = sup.binding.operations && sup.binding.operations[contract.method]
  if (!bind) throw new Error(`openapi block: binding maps no ${contract.method}`)
  const resolved = sup.ops[bind.op]
  if (!resolved) throw new Error(`openapi block: spec has no operation ${bind.op}`)
  const noun = seamNoun(sup.binding.seam)

  const body = await evalExpr(bind.request, input) // no request expression → no body
  checkRequired(body, resolved.required, noun)
  const payload = encodeBody(body, resolved.media, noun)
  const url = baseOf(sup, args) + substitutePath(resolved.pathTemplate, input)
    + await renderQuery(bind.query, input)

  // Retry a transient failure per the seam's read/write policy, then classify + map. A revoked /
  // rejected fault is permanent and never retried.
  const parsed = await withRetry(contract.method, async () => {
    const res = await doFetch(resolved.method, url, payload, args, noun)
    return readAndClassify(res, noun)
  })
  // A binding with a response expression owns the shape: undefined there means "no such field",
  // which the canonical shape reads as empty — never the raw response in its place.
  const respExpr = compileExpr(bind.response)
  const mapped = respExpr ? await respExpr.evaluate(parsed) : parsed
  return contract.canon(mapped)
}

// callRaw — an agent tool: one spec operation by operationId, no binding. args is the body (unless
// the method is GET or DELETE) and the source of path parameters; the response comes back raw.
async function callRaw(sup, args) {
  const resolved = sup.ops[args.op_id]
  if (!resolved) throw new Error(`[fault:rejected] the spec has no operation ${args.op_id}`)
  const input = args.args && typeof args.args === 'object' ? args.args : {}
  const withBody = !['GET', 'DELETE'].includes(resolved.method) && args.args !== undefined
  const payload = withBody ? { contentType: 'application/json', text: JSON.stringify(args.args) } : null
  const url = baseOf(sup, args) + substitutePath(resolved.pathTemplate, input)
  const res = await doFetch(resolved.method, url, payload, args, 'connection')
  const text = await res.text()
  if (res.status >= 400) throw statusFault(res.status, text, 'connection')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return text
  }
}

// baseOf — the host's base_url wins over the spec's own server (the host env-expands it).
function baseOf(sup, args) {
  return (typeof args.base_url === 'string' && args.base_url ? args.base_url : sup.baseURL).replace(/\/$/, '')
}

// seamNoun — the word the block uses in its own user-facing fault sentences.
function seamNoun(seam) {
  return seam || 'connection'
}

// READ_METHODS — the idempotent reads. A read gets the full transient budget; a write is retried
// only on a raw network failure (never on an HTTP status) — a double write is worse than one clean
// failure.
const READ_METHODS = new Set(['list_busy'])

// isTransient — a classified PERMANENT fault leads with a [fault:...] token; anything else (a raw
// network throw, a 429/5xx with no token) is the retryable transient class.
function isTransient(err) {
  return !/^\[fault:(rejected|revoked)\]/.test(String((err && err.message) || err))
}

// withRetry — read: up to 3 attempts, 1s/2s backoff. write: one retry, network-only.
async function withRetry(method, attempt) {
  const read = READ_METHODS.has(method)
  const max = read ? 3 : 2
  let waitMs = 1000
  for (let i = 1; ; i += 1) {
    try {
      return await attempt()
    } catch (e) {
      const httpStatus = Boolean(e && e.httpStatus)
      const retryable = read ? isTransient(e) : (isTransient(e) && !httpStatus)
      if (i >= max || !retryable) throw e
      await new Promise((resolve) => { setTimeout(resolve, waitMs) })
      waitMs *= 2
    }
  }
}

// evalExpr — evaluate a request JSONata source (scalar or structured); no source → no body.
async function evalExpr(src, input) {
  const expr = compileExpr(src)
  return expr ? expr.evaluate(input) : null
}

// checkRequired — the body misses a field the spec declares required (absent or null) → refuse
// before sending: a malformed request is never sent.
function checkRequired(body, required, noun) {
  if (!required || required.length === 0) return
  const m = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  for (const f of required) {
    if (m[f] === undefined || m[f] === null) {
      throw new Error(`[fault:rejected] ${noun} request invalid: required request field missing: "${f}"`)
    }
  }
}

// encodeBody — encode by the media type the spec declares (F-C-54): a form-only vendor sent JSON
// sees no fields at all. multipart is refused out loud rather than sent as something else.
function encodeBody(body, media, noun) {
  if (body === null || body === undefined) return null
  if (media === 'application/x-www-form-urlencoded') {
    return { contentType: media, text: encodeForm(body, noun) }
  }
  if (media === 'multipart/form-data') {
    throw new Error(`[fault:rejected] ${noun} request invalid: unsupported request body media type: this operation declares multipart/form-data`)
  }
  return { contentType: media || 'application/json', text: JSON.stringify(body) }
}

// encodeForm — a flat object → a=1&b=2. A nested value means the binding is wrong: say so.
function encodeForm(body, noun) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`[fault:rejected] ${noun} request invalid: unsupported request body media type: a form body must be a flat object`)
  }
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) {
    if (!['string', 'number', 'boolean'].includes(typeof v)) {
      throw new Error(`[fault:rejected] ${noun} request invalid: unsupported request body media type: field "${k}"`)
    }
    form.set(k, String(v))
  }
  return form.toString()
}

// renderQuery — query JSONata → "?a=1&b=2"; empty and non-scalar values are dropped (a JSONata
// ternary expresses "include only when…").
async function renderQuery(src, input) {
  const expr = compileExpr(src)
  if (!expr) return ''
  const m = await expr.evaluate(input)
  if (!m || typeof m !== 'object') return ''
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(m)) {
    if (v === null || v === undefined || v === '' || typeof v === 'object') continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

// substitutePath — replace {name} in the path template from the input; an absent one stays as is.
function substitutePath(tmpl, input) {
  return tmpl.replace(/\{([^}]+)\}/g, (whole, name) => (
    input && input[name] !== undefined && input[name] !== null ? encodeURIComponent(String(input[name])) : whole))
}

// doFetch — apply the host's auth (headers and query) and send. The engine knows no auth scheme.
async function doFetch(method, url, payload, args, noun) {
  const headers = { ...(args.auth_headers || {}) }
  const u = new URL(url)
  for (const [k, v] of Object.entries(args.auth_query || {})) u.searchParams.set(k, v)
  if (payload) headers['Content-Type'] = payload.contentType
  return io.fetch(u.toString(), {
    method, headers, body: payload ? payload.text : undefined, allowHosts: args.allow_hosts || [], noun,
  })
}

// readAndClassify — read + JSON-decode the body; on an error status throw a classified fault.
async function readAndClassify(res, noun) {
  const text = (await res.text()).slice(0, MAX_RESPONSE_BYTES)
  if (res.status >= 400) throw statusFault(res.status, text, noun)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

// statusFault — 401/403 with a freshly resolved token means the grant is gone: reconnect, not
// retry. Other 4xx (but 429) are permanent ("rejected"); 429/5xx are transient.
function statusFault(status, text, noun) {
  if (status === 401 || status === 403) {
    return new Error(`[fault:revoked] the ${noun} access was revoked — reconnect it to continue`)
  }
  const permanent = status < 500 && status !== 429
  // A transient answer (429 / 5xx) is the block's own sentence, not the provider's status and body:
  // the host shows it to the owner as it stands.
  const err = permanent
    ? new Error(`[fault:rejected] openapi call ${status}: ${text.slice(0, 200)}`)
    : new Error(`the ${noun} provider is busy right now — try again in a moment`)
  err.httpStatus = status
  return err
}

// ── the egress guard. The sandbox has the host's network, so the block itself refuses internal
// addresses: a literal internal IP or a blocked name before connecting, every resolved address at
// dial time (a DNS answer cannot rebind between the check and the connect), and every redirect hop
// again. Hosts the owner allowed on /admin/system pass as they are.

function blockedFault(noun) {
  return new Error(`[fault:rejected] ${noun} supplier blocked: target resolves to an internal/private address`)
}

function isInternalIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isInternalIP(v.slice(7))
  return v === '::' || v === '::1' || v.startsWith('fe80') || v.startsWith('fc') ||
    v.startsWith('fd') || v.startsWith('ff')
}

function blockedName(host) {
  const h = host.toLowerCase()
  return h === 'localhost' || h === 'metadata.google.internal' || h.endsWith('.internal') ||
    h.endsWith('.local') || h.endsWith('.localhost')
}

// guardedLookupFor — dns.lookup that refuses an internal answer. Node asks with {all:true} under
// happy-eyeballs and expects the list back; otherwise one address.
function guardedLookupFor(noun) {
  return (hostname, opts, cb) => {
    dns.lookup(hostname, { all: true, family: opts && opts.family }, (err, addrs) => {
      if (err) return cb(err)
      if (!addrs.length) return cb(new Error(`${hostname} resolved to no addresses`))
      if (addrs.some((a) => isInternalIP(a.address))) return cb(blockedFault(noun))
      if (opts && opts.all) return cb(null, addrs)
      return cb(null, addrs[0].address, addrs[0].family)
    })
  }
}

// guardedFetch — a minimal fetch (status + text()) over http/https with the guard on every hop.
async function guardedFetch(url, { method, headers, body, allowHosts, noun }) {
  const allowed = new Set((allowHosts || []).map((h) => h.toLowerCase()))
  let target = new URL(url)
  let req = { method, headers: { 'User-Agent': 'node', ...headers }, body }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const host = target.hostname.replace(/^\[|\]$/g, '')
    const trusted = allowed.has(host.toLowerCase())
    if (!trusted && (blockedName(host) || (net.isIP(host) && isInternalIP(host)))) throw blockedFault(noun)
    const res = await send(target, req, trusted ? undefined : guardedLookupFor(noun))
    const location = res.headers.location
    if (res.status < 300 || res.status >= 400 || !location) return res
    target = new URL(location, target)
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && req.method !== 'GET')) {
      const { 'Content-Type': _ct, ...rest } = req.headers
      req = { method: 'GET', headers: rest, body: undefined }
    }
  }
  throw new Error(`[fault:rejected] ${noun} supplier redirected too many times`)
}

function send(target, { method, headers, body }, lookup) {
  const mod = target.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const r = mod.request(target, { method, headers, lookup, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size <= MAX_RESPONSE_BYTES) chunks.push(c)
      })
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, text: async () => text })
      })
      res.on('error', reject)
    })
    r.on('timeout', () => r.destroy(new Error('the request timed out')))
    r.on('error', reject)
    if (body !== undefined) r.write(body)
    r.end()
  })
}

module.exports = { callVerb, callRaw, substitutePath, renderQuery, io, guardedFetch, guardedLookupFor, isInternalIP }
