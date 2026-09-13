// caldav-plugin.js — CalDAV as a Koishi plugin.
//
// This is the whole point of "caldav is a block, not a base protocol": it is an application on
// HTTP, so it plugs into Koishi like any other block and COMPOSES the http hand. Here that hand is
// Koishi's own `http` service (`inject: ['http']`), used for the WebDAV requests (PROPFIND / REPORT
// free-busy-query / PUT a VEVENT / DELETE). The iCalendar it gets back is parsed by **ical.js** — a
// real library, unmodified — not a hand-written line-scanner. No Go anywhere: the block is this
// Koishi plugin; Go lives only in the substrate that runs it.
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
  const out = []
  for (const fb of comp.getAllSubcomponents('vfreebusy')) {
    for (const prop of fb.getAllProperties('freebusy')) {
      // FREEBUSY holds one or more periods; each is a { start, duration|end }.
      for (const period of prop.getValues()) {
        const start = period.start.toJSDate()
        const end = period.end
          ? period.end.toJSDate()
          : new Date(period.start.toJSDate().getTime() + period.duration.toSeconds() * 1000)
        out.push({ start: start.toISOString(), end: end.toISOString() })
      }
    }
  }
  return out
}

// caldavRequest — one WebDAV request through Koishi's http hand, with basic auth. Returns
// { status, body }.
async function caldavRequest(http, conn, method, url, body, contentType) {
  const headers = {}
  if (contentType) headers['Content-Type'] = contentType
  if (conn.username) {
    const tok = Buffer.from(`${conn.username}:${conn.password || ''}`).toString('base64')
    headers.Authorization = `Basic ${tok}`
  }
  // ctx.http(method, url, config) — undici under the hood accepts arbitrary methods (REPORT,
  // PROPFIND). validateStatus:true so a 4xx/5xx comes back as a status, not a throw.
  const resp = await http(method, url, {
    headers,
    data: body,
    responseType: 'text',
    validateStatus: () => true,
  })
  return { status: resp.status, body: typeof resp.data === 'string' ? resp.data : String(resp.data) }
}

const XML = 'application/xml; charset=utf-8'
const ICS = 'text/calendar; charset=utf-8'

// apply — register the `caldav` service. Koishi calls this with the plugin's context; `inject`
// guarantees `ctx.http` is present before it runs.
function apply(ctx) {
  const http = ctx.http
  ctx.set('caldav', {
    // verify — one PROPFIND against the collection (no write). Throws on a 4xx/5xx.
    async verify(conn) {
      const r = await caldavRequest(http, conn, 'PROPFIND', conn.url, '', XML)
      if (r.status >= 400) throw new Error(`caldav verify: status ${r.status}`)
      return { ok: true }
    },
    // freeBusy — REPORT free-busy-query → busy intervals (via ical.js).
    async freeBusy(conn, timeMin, timeMax) {
      const r = await caldavRequest(
        http, conn, 'REPORT', conn.url, freeBusyQuery(new Date(timeMin), new Date(timeMax)), XML,
      )
      if (r.status >= 400) throw new Error(`caldav free-busy: status ${r.status}`)
      return { busy: parseFreeBusy(r.body) }
    },
    // insertEvent — PUT a VEVENT (UID idempotent).
    async insertEvent(conn, ev) {
      const uid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g, '')
      const url = `${conn.url.replace(/\/$/, '')}/${uid}.ics`
      const r = await caldavRequest(
        http, conn, 'PUT', url,
        vevent(uid, ev.summary, new Date(ev.start), new Date(ev.end), ev.visitorEmail), ICS,
      )
      if (r.status >= 400) throw new Error(`caldav insert: status ${r.status}`)
      return { eventId: uid, htmlLink: url }
    },
    // deleteEvent — DELETE the event's .ics.
    async deleteEvent(conn, eventId) {
      const url = `${conn.url.replace(/\/$/, '')}/${eventId}.ics`
      const r = await caldavRequest(http, conn, 'DELETE', url, '', '')
      if (r.status >= 400 && r.status !== 404) throw new Error(`caldav delete: status ${r.status}`)
      return { ok: true }
    },
  })
}

module.exports = { inject: ['http'], apply }
