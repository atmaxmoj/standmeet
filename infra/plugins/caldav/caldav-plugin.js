// caldav-plugin.js — CalDAV as a standalone cordis/koishi plugin.
//
// This is the whole point of "caldav is a block, not a base protocol": it is an application on
// HTTP. The HTTP hand is the runtime's own global `fetch` (undici, built into Node 18+), which
// takes arbitrary methods (PROPFIND / REPORT free-busy-query / PUT a VEVENT / DELETE), custom
// headers, a body, and does not throw on 4xx/5xx. Depending on `fetch` — not on any host service —
// is what lets this plugin boot on a bare cordis host (real DSH included): it injects nothing, so
// there is no service to wait for. The iCalendar it gets back is parsed by **ical.js** — a real
// library, unmodified — not a hand-written line-scanner. No Go anywhere: the block is this plugin;
// Go lives only in the substrate that runs it.
//
// It provides the `caldav` service with the four calendar-seam operations. A connection
// (url/username/password) is passed per call by the caller — the plugin holds no credentials.

const ICAL = require('ical.js')

// z-less time formats iCalendar uses. ical.js does the parsing; we only format request times.
const pad = (n) => String(n).padStart(2, '0')
const icalUTC = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

const freeBusyQuery = (min, max) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  `<C:time-range start="${icalUTC(min)}" end="${icalUTC(max)}"/></C:free-busy-query>`

const vevent = (uid, summary, start, end, attendee) => {
  let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//StandMeet//CalDAV//EN\r\nBEGIN:VEVENT\r\n'
  s += `UID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART:${icalUTC(start)}\r\nDTEND:${icalUTC(end)}\r\n`
  if (attendee) s += `ATTENDEE:mailto:${attendee}\r\n`
  return s + 'END:VEVENT\r\nEND:VCALENDAR\r\n'
}

// parseFreeBusy — busy [start,end] ranges out of a VFREEBUSY response, via ical.js. Distinguishes
// the two facts the Go port had to hand-code (F-C-50): a response with NO busy periods is empty
// (an answer); a response we cannot parse at all throws (never silently "empty"). ical.js also
// resolves TZID-qualified times itself, so the "unknown TZID must not become UTC" trap is the
// library's problem, not ours.
function parseFreeBusy(body) {
  let comp
  try {
    comp = new ICAL.Component(ICAL.parse(body))
  } catch (e) {
    throw new Error(`free-busy response could not be parsed: ${e.message}`)
  }
  const vfbs = comp.getAllSubcomponents('vfreebusy')
  const out = []
  for (const fb of vfbs) {
    for (const iv of vfreebusyIntervals(fb)) out.push(iv)
  }
  // F-C-50: "unreadable" and "no busy time" are OPPOSITE facts. Zero VFREEBUSY components = an empty
  // calendar (an answer) → []. But components present that we could not read any interval out of =
  // we failed to read the response → throw, never silently report the calendar as free.
  if (vfbs.length > 0 && out.length === 0) {
    throw new Error('free-busy components present but no interval parsed (unreadable ≠ empty)')
  }
  return out
}

// vfreebusyIntervals — the two real-world encodings of a busy interval inside one VFREEBUSY:
//   FREEBUSY[;params]:<start>/<end|dur>   the property form (Google / Fastmail family)
//   DTSTART / DTEND on the VFREEBUSY      the component form (Radicale family) — no FREEBUSY line
function vfreebusyIntervals(fb) {
  const out = []
  const props = fb.getAllProperties('freebusy')
  if (props.length > 0) {
    for (const prop of props) {
      for (const period of prop.getValues()) {
        const start = period.start.toJSDate()
        const end = period.end
          ? period.end.toJSDate()
          : new Date(period.start.toJSDate().getTime() + period.duration.toSeconds() * 1000)
        out.push({ start: start.toISOString(), end: end.toISOString() })
      }
    }
    return out
  }
  const dtstart = fb.getFirstPropertyValue('dtstart')
  const dtend = fb.getFirstPropertyValue('dtend')
  if (dtstart && dtend) {
    out.push({ start: dtstart.toJSDate().toISOString(), end: dtend.toJSDate().toISOString() })
  }
  return out
}

// caldavRequest — one WebDAV request via the runtime's global fetch, with basic auth. Returns
// { status, body }. fetch accepts arbitrary methods (REPORT, PROPFIND) and does not throw on
// 4xx/5xx (only on transport failure), so the status comes back for the callers to check.
async function caldavRequest(conn, method, url, body, contentType) {
  const headers = {}
  if (contentType) headers['Content-Type'] = contentType
  if (conn.username) {
    const tok = Buffer.from(`${conn.username}:${conn.password || ''}`).toString('base64')
    headers.Authorization = `Basic ${tok}`
  }
  const resp = await fetch(url, { method, headers, body: body || undefined })
  return { status: resp.status, body: await resp.text() }
}

const XML = 'application/xml; charset=utf-8'
const ICS = 'text/calendar; charset=utf-8'

// apply — register the `caldav` service. The cordis/koishi host calls this with the plugin's
// context. It injects nothing: the HTTP hand is the runtime's global fetch, always present.
// `ctx.provide(name, value)` both declares and sets the service — cordis 4.x refuses a bare
// `ctx.set` for a name that was never provided (koishi's `set` auto-provides; cordis does not).
function apply(ctx) {
  ctx.provide('caldav', {
    // verify — one PROPFIND against the collection (no write). Throws on a 4xx/5xx.
    async verify(conn) {
      const r = await caldavRequest(conn, 'PROPFIND', conn.url, '', XML)
      if (r.status >= 400) throw new Error(`caldav verify: status ${r.status}`)
      return { ok: true }
    },
    // freeBusy — REPORT free-busy-query → busy intervals (via ical.js).
    async freeBusy(conn, timeMin, timeMax) {
      const r = await caldavRequest(
        conn, 'REPORT', conn.url, freeBusyQuery(new Date(timeMin), new Date(timeMax)), XML,
      )
      if (r.status >= 400) throw new Error(`caldav free-busy: status ${r.status}`)
      return { busy: parseFreeBusy(r.body) }
    },
    // insertEvent — PUT a VEVENT (UID idempotent).
    async insertEvent(conn, ev) {
      const uid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g, '')
      const url = `${conn.url.replace(/\/$/, '')}/${uid}.ics`
      const r = await caldavRequest(
        conn, 'PUT', url,
        vevent(uid, ev.summary, new Date(ev.start), new Date(ev.end), ev.visitorEmail), ICS,
      )
      if (r.status >= 400) throw new Error(`caldav insert: status ${r.status}`)
      return { eventId: uid, htmlLink: url }
    },
    // deleteEvent — DELETE the event's .ics.
    async deleteEvent(conn, eventId) {
      const url = `${conn.url.replace(/\/$/, '')}/${eventId}.ics`
      const r = await caldavRequest(conn, 'DELETE', url, '', '')
      if (r.status >= 400 && r.status !== 404) throw new Error(`caldav delete: status ${r.status}`)
      return { ok: true }
    },
  })
}

module.exports = { apply }
