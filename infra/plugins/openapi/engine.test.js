// engine.test.js — the openapi-runtime engine's pure unit test (design test #2 of
// docs/design/plugin/openapi-runtime-block.md). No host, no network: a stubbed `fetch` feeds the
// engine hand-written spec/binding + canned SaaS responses, and we assert the block's OWN behavior
// — the behavior that, per the fold, must live in the block and not in host Go.
//
// Written from the design, not from the engine's current code. The engine must satisfy THIS.
// Two assertions are RED against today's engine and drive the fold:
//   F1  a 401 (revoked grant) → a REVOKED fault ("reconnect"), not the generic rejected/unavailable.
//   F2  a transient read error, then success → the read retry absorbs it and slots come back.
// The shape assertion is a green sanity check (the engine already maps free_busy → {busy}).

const test = require('node:test')
const assert = require('node:assert')

const { indexOps, SEAM } = require('./engine.js')
const { callVerb } = require('./engine_call.js')

// A made-up calendar SaaS, inline — never reached (fetch is stubbed). It exists only to give the
// engine a spec+binding to resolve, exactly as the design's "hand-written fixtures" prescribe.
const spec = {
  openapi: '3.1.0',
  servers: [{ url: 'https://saas.test/v1' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/freeBusy': { post: { operationId: 'freebusy.query' } },
    '/events': { post: { operationId: 'events.insert' } },
    '/events/{eventId}': { delete: { operationId: 'events.delete' } },
  },
}
const binding = {
  seam: 'calendar',
  operations: {
    list_busy: { op: 'freebusy.query', request: '{ "timeMin": timeMin }', response: '{ "busy": busy }' },
    create_event: { op: 'events.insert', request: '{ "summary": summary }', response: '{ "id": id, "htmlLink": htmlLink }' },
    cancel_event: { op: 'events.delete', query: '{ "sendUpdates": attendeeEmail ? "all" }' },
  },
}
const sup = { spec, binding, ops: indexOps(spec), baseURL: 'https://saas.test/v1' }
const cal = SEAM.calendar

function stubFetch(fn) {
  const orig = global.fetch
  global.fetch = fn
  return () => { global.fetch = orig }
}
const httpRes = (status, body) => ({ status, text: async () => JSON.stringify(body) })

test('free_busy maps a SaaS response to the canonical {busy} shape', async () => {
  const restore = stubFetch(async () => httpRes(200, { busy: [{ start: 'a', end: 'b' }] }))
  try {
    const out = await callVerb(sup, 'free_busy', cal.free_busy, { time_min: 'x', time_max: 'y', access_token: 't' })
    assert.deepEqual(out, { busy: [{ start: 'a', end: 'b' }] })
  } finally { restore() }
})

test('F1: a 401 is a REVOKED fault (owner must be told to reconnect), not generic', async () => {
  const restore = stubFetch(async () => httpRes(401, { error: { code: 401, message: 'Invalid Credentials' } }))
  try {
    await assert.rejects(
      () => callVerb(sup, 'free_busy', cal.free_busy, { access_token: 'stale' }),
      (e) => /\[fault:revoked\]/.test(e.message) && /revoked/i.test(e.message),
      'a 401 must classify as revoked so the host says "reconnect", not "try again later"',
    )
  } finally { restore() }
})

test('F2: a transient read failure then a success returns slots (retry absorbs it)', async () => {
  let calls = 0
  const restore = stubFetch(async () => {
    calls += 1
    if (calls === 1) throw new Error('ECONNRESET') // one transient network failure
    return httpRes(200, { busy: [{ start: 'a', end: 'b' }] })
  })
  try {
    const out = await callVerb(sup, 'free_busy', cal.free_busy, { access_token: 't' })
    assert.equal(out.busy.length, 1, 'the read retry must absorb one transient error and still return slots')
    assert.ok(calls >= 2, 'the engine must have retried the transient failure')
  } finally { restore() }
})
