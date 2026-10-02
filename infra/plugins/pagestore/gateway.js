// gateway.js — sandbox-side reach-back client (JS port of the Go blocks' gateway.go + callHost).
//
// Anything the block can't reach directly (the owner's active supplier, corpus, booking store) goes
// through the unix socket bound into the sandbox at STANDMEET_HOST_SOCKET, calling a FIXED vocabulary
// of host ops — no new op can be added here. Each reach-back is authenticated with STANDMEET_NATIVE_KEY
// (rule 4). Protocol: connect, write one line of JSON, read one line of JSON; an `{error}` envelope
// becomes a thrown error. Ported verbatim from mcp-servers/*/{main.go callHost, gateway.go}.

const net = require('net')

// callHost — one line-JSON request/response over the socket bound at STANDMEET_HOST_SOCKET.
function callHost(reqObj) {
  return new Promise((resolve, reject) => {
    const path = process.env.STANDMEET_HOST_SOCKET
    if (!path) return reject(new Error(`${'STANDMEET_HOST_SOCKET'} not set`))
    const key = process.env.STANDMEET_NATIVE_KEY
    if (key) reqObj.native_key = key // rule 4: authenticate this reach-back
    const conn = net.createConnection(path)
    let buf = ''
    let settled = false
    const done = (fn, v) => { if (!settled) { settled = true; try { conn.destroy() } catch { /* noop */ } fn(v) } }
    conn.on('connect', () => conn.write(JSON.stringify(reqObj) + '\n'))
    conn.on('data', (d) => {
      buf += d.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl >= 0) done(resolve, buf.slice(0, nl))
    })
    conn.on('error', (e) => done(reject, new Error(`dial host socket: ${e.message}`)))
    conn.on('end', () => { if (buf) done(resolve, buf); else done(reject, new Error('no response from host')) })
  })
}

// gwCall — send a fixed-vocabulary op, return raw JSON string; a host error envelope throws.
async function gwCall(op, fields) {
  fields.op = op
  const raw = await callHost(fields)
  let parsed
  try { parsed = JSON.parse(raw) } catch { parsed = null }
  if (parsed && typeof parsed === 'object' && parsed.error) {
    // Carry the host fault CATEGORY (not_configured / unavailable) so callers can branch on it
    // instead of matching the sentence (which is not a contract). See booker friendlyCalErr/mailSendErr.
    const e = new Error(`host ${op}: ${parsed.error}`)
    e.hostCode = typeof parsed.code === 'string' ? parsed.code : ''
    throw e
  }
  return raw
}

// gwSupplierInvoke — call one verb on the owner's active supplier by seam name. `args` is a plain
// object (serialized as nested JSON on the wire, matching the Go json.RawMessage form).
function gwSupplierInvoke(ownerID, seam, verb, args) {
  return gwCall('supplier.invoke', { owner_id: ownerID, seam, verb, args })
}

// sessionFromMeta — the trusted session the host plants on the tool-call `_meta`. In the JS MCP SDK
// the tool callback's second arg (`extra`) carries the request `_meta`.
function sessionFromMeta(extra) {
  const s = extra && extra._meta && extra._meta['standmeet/session']
  return { ownerID: (s && s.owner_id) || '', visitorEmail: (s && s.visitor_email) || '' }
}

module.exports = { callHost, gwCall, gwSupplierInvoke, sessionFromMeta }
