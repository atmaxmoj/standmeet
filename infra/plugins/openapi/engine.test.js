// engine.test.js — the openapi-runtime engine's own behavior, with no host and no SaaS: a stubbed
// io.fetch feeds the engine canned responses, and the egress guard is exercised against a local
// server. Run: node --test (from infra/plugins/openapi, after provisioning node_modules).

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const http = require('http')
const path = require('path')

const { parseSupplier, SEAM } = require('./engine.js')
const { callVerb, callRaw, io, guardedFetch, guardedLookupFor } = require('./engine_call.js')

// A made-up SaaS, inline — reached only through the stub.
const SPEC = `
openapi: 3.1.0
servers: [{ url: 'https://saas.test/v1' }]
paths:
  /freeBusy: { post: { operationId: freebusy.query } }
  /events:
    post:
      operationId: events.insert
      requestBody:
        content:
          application/json: { schema: { required: [summary] } }
  /events/{eventId}: { delete: { operationId: events.delete } }
  /send:
    post:
      operationId: mail.send
      requestBody:
        content:
          application/x-www-form-urlencoded: { schema: { required: [to] } }
  /upload:
    post:
      operationId: upload
      requestBody: { content: { multipart/form-data: {} } }
  /contacts/{id}: { get: { operationId: contacts.get } }
  /deals: { post: { operationId: deals.create } }
`
const CAL_BINDING = `
seam: calendar
operations:
  list_busy: { op: freebusy.query, request: '{ "timeMin": timeMin }', response: '{ "busy": busy }' }
  create_event: { op: events.insert, request: '{ "summary": summary }', response: '{ "id": id, "htmlLink": htmlLink }' }
  cancel_event: { op: events.delete, query: '{ "sendUpdates": attendeeEmail ? "all" }' }
`
const MAIL_BINDING = `
seam: mail
operations:
  send: { op: mail.send, request: '{ "to": to, "subject": subject, "text": body }', response: '{ "id": id }' }
`
const cal = parseSupplier(SPEC, CAL_BINDING)
const mail = parseSupplier(SPEC, MAIL_BINDING)
const agent = parseSupplier(SPEC, undefined)

// stub — replace the network hand; records every request.
function stub(fn) {
  const calls = []
  const orig = io.fetch
  io.fetch = async (url, opts) => { calls.push({ url, ...opts }); return fn(url, opts, calls.length) }
  return { calls, restore: () => { io.fetch = orig } }
}
const httpRes = (status, body) => ({ status, text: async () => JSON.stringify(body) })

test('free_busy maps a SaaS response to the canonical {busy} shape', async () => {
  const s = stub(() => httpRes(200, { busy: [{ start: 'a', end: 'b' }] }))
  try {
    const out = await callVerb(cal, 'free_busy', SEAM.calendar.free_busy, { time_min: 'x' })
    assert.deepEqual(out, { busy: [{ start: 'a', end: 'b' }] })
  } finally { s.restore() }
})

test('a response field of the wrong shape reads as empty, not as garbage', async () => {
  const s = stub(() => httpRes(200, [{ id: 'x' }, { id: 'y' }]))
  try {
    const out = await callVerb(cal, 'insert_event', SEAM.calendar.insert_event, { summary: 's' })
    assert.equal(out.eventId, '', 'an array id is not an event id')
  } finally { s.restore() }
})

test('the host-resolved auth headers and query are applied as given', async () => {
  const s = stub(() => httpRes(200, { busy: [] }))
  try {
    await callVerb(cal, 'free_busy', SEAM.calendar.free_busy, {
      auth_headers: { Authorization: 'Basic dTpw' }, auth_query: { key: 'k1' },
    })
    assert.equal(s.calls[0].headers.Authorization, 'Basic dTpw')
    assert.match(s.calls[0].url, /[?&]key=k1/)
  } finally { s.restore() }
})

test('base_url from the host wins over the spec server', async () => {
  const s = stub(() => httpRes(200, { busy: [] }))
  try {
    await callVerb(cal, 'free_busy', SEAM.calendar.free_busy, { base_url: 'http://mock:9000/cal/' })
    assert.equal(s.calls[0].url, 'http://mock:9000/cal/freeBusy')
  } finally { s.restore() }
})

test('a missing required field is refused before anything is sent', async () => {
  const s = stub(() => httpRes(200, {}))
  try {
    await assert.rejects(
      () => callVerb(cal, 'insert_event', SEAM.calendar.insert_event, {}),
      (e) => /^\[fault:rejected\]/.test(e.message) && /required request field missing: "summary"/.test(e.message),
    )
    assert.equal(s.calls.length, 0, 'nothing went out')
  } finally { s.restore() }
})

test('a form-encoded operation is sent as a form (F-C-54), and its id comes back', async () => {
  const s = stub(() => httpRes(200, { id: '<m1@x>' }))
  try {
    const out = await callVerb(mail, 'send', SEAM.mail.send, { to: 'a@b.c', subject: 'hi', body: 'yo' })
    assert.equal(s.calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded')
    assert.equal(s.calls[0].body, 'to=a%40b.c&subject=hi&text=yo')
    assert.deepEqual(out, { id: '<m1@x>' })
  } finally { s.restore() }
})

test('a DELETE with no request expression carries no body, and the query renders', async () => {
  const s = stub(() => httpRes(204, ''))
  try {
    await callVerb(cal, 'delete_event', SEAM.calendar.delete_event, { event_id: 'e/1', attendee_email: 'x@y' })
    assert.equal(s.calls[0].method, 'DELETE')
    assert.equal(s.calls[0].body, undefined)
    assert.equal(s.calls[0].url, 'https://saas.test/v1/events/e%2F1?sendUpdates=all')
  } finally { s.restore() }
})

test('multipart is refused out loud, not sent as JSON', async () => {
  const sup = parseSupplier(SPEC, 'seam: mail\noperations:\n  send: { op: upload, request: \'{ "a": to }\' }\n')
  const s = stub(() => httpRes(200, {}))
  try {
    await assert.rejects(() => callVerb(sup, 'send', SEAM.mail.send, { to: 'x' }), /multipart\/form-data/)
    assert.equal(s.calls.length, 0)
  } finally { s.restore() }
})

test('mail verify passes with no call', async () => {
  const s = stub(() => httpRes(500, {}))
  try {
    assert.deepEqual(await callVerb(mail, 'verify', SEAM.mail.verify, {}), { ok: true })
    assert.equal(s.calls.length, 0)
  } finally { s.restore() }
})

test('F1: a 401 is a REVOKED fault (reconnect), not generic', async () => {
  const s = stub(() => httpRes(401, { error: 'Invalid Credentials' }))
  try {
    await assert.rejects(
      () => callVerb(cal, 'free_busy', SEAM.calendar.free_busy, {}),
      (e) => /^\[fault:revoked\]/.test(e.message),
    )
  } finally { s.restore() }
})

test('F2: a transient read failure then a success returns slots (retry absorbs it)', async () => {
  const s = stub((_u, _o, n) => {
    if (n === 1) throw new Error('ECONNRESET')
    return httpRes(200, { busy: [{ start: 'a', end: 'b' }] })
  })
  try {
    const out = await callVerb(cal, 'free_busy', SEAM.calendar.free_busy, {})
    assert.equal(out.busy.length, 1)
    assert.equal(s.calls.length, 2)
  } finally { s.restore() }
})

test('raw_call: GET takes path params from args and sends no body; POST sends args as JSON', async () => {
  const s = stub(() => httpRes(200, { ok: 1 }))
  try {
    assert.deepEqual(await callRaw(agent, { op_id: 'contacts.get', args: { id: 7 } }), { ok: 1 })
    assert.equal(s.calls[0].url, 'https://saas.test/v1/contacts/7')
    assert.equal(s.calls[0].body, undefined)
    await callRaw(agent, { op_id: 'deals.create', args: { name: 'd' } })
    assert.equal(s.calls[1].body, '{"name":"d"}')
    assert.equal(s.calls[1].headers['Content-Type'], 'application/json')
    await assert.rejects(() => callRaw(agent, { op_id: 'nope' }), /no operation nope/)
  } finally { s.restore() }
})

// ── the egress guard, against a real local server ──

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(srv))
  })
}

test('guard: an internal address is refused unless the owner allowed that host', async () => {
  const srv = await serve((req, res) => res.end(JSON.stringify({ ua: req.headers['user-agent'] })))
  const url = `http://127.0.0.1:${srv.address().port}/`
  try {
    await assert.rejects(() => guardedFetch(url, { method: 'GET', headers: {}, noun: 'mail' }),
      (e) => /^\[fault:rejected\] mail supplier blocked/.test(e.message))
    const res = await guardedFetch(url, { method: 'GET', headers: {}, allowHosts: ['127.0.0.1'], noun: 'mail' })
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(await res.text()).ua, 'node', 'the block speaks as node')
  } finally { srv.close() }
})

test('guard: a redirect into the metadata address is refused', async () => {
  const srv = await serve((req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' })
    res.end()
  })
  try {
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${srv.address().port}/`, {
        method: 'POST', headers: {}, body: '{}', allowHosts: ['127.0.0.1'], noun: 'calendar',
      }),
      (e) => /blocked/.test(e.message) && !/meta-data/.test(e.message),
    )
  } finally { srv.close() }
})

test('guard: a name resolving to an internal address is refused at dial time', async () => {
  const lookup = guardedLookupFor('calendar')
  const err = await new Promise((resolve) => { lookup('localhost', { all: true }, (e) => resolve(e)) })
  assert.match(String(err && err.message), /blocked/)
  await assert.rejects(() => guardedFetch('http://localhost:1/', { method: 'GET', headers: {}, noun: 'x' }), /blocked/)
})

test('the google-calendar copy of the engine is this engine', () => {
  for (const f of ['engine.js', 'engine_call.js']) {
    const here = fs.readFileSync(path.join(__dirname, f), 'utf8')
    const there = fs.readFileSync(path.join(__dirname, '..', 'google-calendar', f), 'utf8')
    assert.equal(there, here, `infra/plugins/google-calendar/${f} drifted — copy it from infra/plugins/openapi`)
  }
})
