// engine_call.js — one openapi seam-verb call: translate → render request/query (JSONata) → resolve
// the spec op → inject auth → fetch → classify status → map response (JSONata) → canonical shape.
// The execution half of engine.js (split for the line budget). A JS port of runtime.go's
// buildRequest/send + the seam adapter's translation.

const { compileExpr } = require('./engine.js')

const MAX_RESPONSE_BYTES = 1 << 20

// callVerb — run one verb end to end, returning the canonical wire object booker consumes.
async function callVerb(sup, verb, contract, args) {
  const input = contract.input(args) // seam snake args → the binding's camelCase contract input
  const bind = sup.binding.operations[contract.method] // {op, request, response, query}
  if (!bind) throw new Error(`openapi block: binding maps no ${contract.method}`)
  const resolved = sup.ops[bind.op] // spec op: {method, pathTemplate}
  if (!resolved) throw new Error(`openapi block: spec has no operation ${bind.op}`)

  const body = await evalExpr(bind.request, input)
  const query = await renderQuery(bind.query, input)
  // base_url from the host's merged creds wins over the block's own spec server: the host
  // env-expands the spec's ${GOOGLE_CALENDAR_BASE} (dev points it at the mock), and the block's
  // baked spec cannot. Falls back to the spec server when the host merges none.
  const base = (typeof args.base_url === 'string' && args.base_url ? args.base_url : sup.baseURL)
    .replace(/\/$/, '')
  const url = base + substitutePath(resolved.pathTemplate, input) + query

  const res = await doFetch(sup, resolved.method, url, body, args)
  const parsed = await readAndClassify(res) // throws a classified fault on 4xx/5xx
  const mapped = await evalExpr(bind.response, parsed) // response JSONata → contract output
  return contract.canon(mapped ?? parsed)
}

// evalExpr — evaluate a compiled JSONata source (scalar or structured) against input; null src → the
// input unchanged for response, or null for request (no body).
async function evalExpr(src, input) {
  const expr = compileExpr(src)
  if (!expr) return src === undefined ? input : null
  return expr.evaluate(input)
}

// renderQuery — query JSONata → "?a=1&b=2"; keys with null/empty values are dropped (a JSONata
// ternary expresses "include only when…"). Scalars only.
async function renderQuery(src, input) {
  const expr = compileExpr(src)
  if (!expr) return ''
  const m = await expr.evaluate(input)
  if (!m || typeof m !== 'object') return ''
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(m)) {
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'object') continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

// substitutePath — replace {name} in the path template from the contract input.
function substitutePath(tmpl, input) {
  return tmpl.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(String(input[name] ?? '')))
}

// doFetch — build + send the HTTP request, injecting auth per the spec's security scheme from the
// credentials the host merged into args (bearer/oauth2 → Authorization: Bearer; apiKey → its
// header/query). No network beyond this call; the sandbox allows egress to the SaaS.
async function doFetch(sup, method, url, body, args) {
  const headers = {}
  let finalURL = url
  const scheme = firstSecurityScheme(sup.spec)
  if (scheme && scheme.type === 'apiKey' && args.api_key) {
    if (scheme.in === 'query') finalURL += `${url.includes('?') ? '&' : '?'}${scheme.name}=${encodeURIComponent(args.api_key)}`
    else headers[scheme.name || 'Authorization'] = args.api_key
  } else if (args.access_token) {
    headers['Authorization'] = `Bearer ${args.access_token}`
  }
  let payload
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  return fetch(finalURL, { method, headers, body: payload })
}

// firstSecurityScheme — the spec's (single) declared security scheme, if any.
function firstSecurityScheme(spec) {
  const schemes = spec?.components?.securitySchemes
  if (!schemes) return null
  const first = Object.values(schemes)[0]
  return first || null
}

// readAndClassify — read + JSON-decode the body; on an error status throw a classified fault the
// substrate maps: 4xx (except 429) is permanent → "[fault:rejected]"; 429/5xx/network are transient
// → plain error → unavailable (retryable). Mirrors runtime.go statusError + the mail/calendar
// classification.
async function readAndClassify(res) {
  const text = (await res.text()).slice(0, MAX_RESPONSE_BYTES)
  if (res.status >= 400) {
    const permanent = res.status < 500 && res.status !== 429
    const prefix = permanent ? '[fault:rejected] ' : ''
    throw new Error(`${prefix}openapi call ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

module.exports = { callVerb, substitutePath, renderQuery }
