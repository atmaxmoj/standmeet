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

// calendarQuery — a REPORT that returns the VEVENTs overlapping [min,max], with their iCalendar
// bodies. This is the UNIVERSAL availability read: iCloud rejects the free-busy-query REPORT
// (HTTP 400) but answers calendar-query (207), and every other CalDAV server (Google / Fastmail /
// Radicale) supports it too. Busy time is then computed from the events themselves (busyFromCalendarData).
const calendarQuery = (min, max) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:prop><C:calendar-data/></D:prop>' +
  '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">' +
  `<C:time-range start="${icalUTC(min)}" end="${icalUTC(max)}"/>` +
  '</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>'

// icalText — escape a TEXT value per RFC 5545: backslash, newline, comma, semicolon. Without it a
// summary/description carrying a comma or newline (a visitor's name, the booking context) would
// corrupt the VEVENT.
const icalText = (v) =>
  String(v == null ? '' : v)
    .replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

const vevent = (uid, summary, start, end, attendee, description) => {
  let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//StandMeet//CalDAV//EN\r\nBEGIN:VEVENT\r\n'
  s += `UID:${uid}\r\nSUMMARY:${icalText(summary)}\r\nDTSTART:${icalUTC(start)}\r\nDTEND:${icalUTC(end)}\r\n`
  if (description) s += `DESCRIPTION:${icalText(description)}\r\n`
  if (attendee) s += `ATTENDEE:mailto:${attendee}\r\n`
  return s + 'END:VEVENT\r\nEND:VCALENDAR\r\n'
}

// unescapeXML — a <calendar-data> element's text is the raw iCalendar, but the multistatus
// envelope may have entity-escaped a stray & / < / > inside it. Undo that before ical.js parses.
const unescapeXML = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// busyFromCalendarData — busy [start,end] intervals from a calendar-query multistatus. Each
// <calendar-data> holds a VCALENDAR with VEVENT(s); a non-TRANSPARENT event's span is busy, and a
// recurring event (RRULE) is expanded to its occurrences within [min,max] via ical.js. Keeps the
// same "unreadable ≠ empty" invariant the VFREEBUSY reader had (F-C-50): calendar-data blocks
// present but none parseable → throw; zero blocks → an empty (free) calendar.
function busyFromCalendarData(body, min, max) {
  const minMs = new Date(min).getTime()
  const maxMs = new Date(max).getTime()
  const blocks = [...body.matchAll(/<[^>]*?calendar-data[^>]*?>([\s\S]*?)<\/[^>]*?calendar-data>/g)]
    .map((m) => {
      // iCloud wraps the iCalendar in <![CDATA[…]]> (raw, un-escaped); other servers inline it
      // with XML entities. Take the CDATA body verbatim, else undo entity escaping.
      const raw = m[1].trim()
      const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
      return (cdata ? cdata[1] : unescapeXML(raw)).trim()
    })
    .filter((s) => s.includes('BEGIN:VCALENDAR'))
  const out = []
  let parsedOk = 0
  for (const ics of blocks) {
    let vcal
    try { vcal = new ICAL.Component(ICAL.parse(ics)) } catch (_e) { continue }
    parsedOk += 1
    for (const ve of vcal.getAllSubcomponents('vevent')) {
      if (String(ve.getFirstPropertyValue('transp') || '').toUpperCase() === 'TRANSPARENT') continue
      let event
      try { event = new ICAL.Event(ve) } catch (_e) { continue }
      pushOccurrences(event, minMs, maxMs, out)
    }
  }
  if (blocks.length > 0 && parsedOk === 0) {
    throw new Error('calendar-data present but none parseable (unreadable ≠ empty)')
  }
  return out
}

// pushOccurrences — one event's busy spans overlapping [minMs,maxMs]. Non-recurring → its own span;
// recurring → each occurrence, bounded by the window and a hard iteration cap so an open-ended RRULE
// can't spin forever. ical.js resolves TZID-qualified times itself.
function pushOccurrences(event, minMs, maxMs, out) {
  const push = (sMs, eMs) => {
    if (eMs > minMs && sMs < maxMs) {
      out.push({ start: new Date(sMs).toISOString(), end: new Date(eMs).toISOString() })
    }
  }
  if (!event.isRecurring()) {
    push(event.startDate.toJSDate().getTime(), event.endDate.toJSDate().getTime())
    return
  }
  const durMs = event.duration ? event.duration.toSeconds() * 1000 : 0
  const it = event.iterator()
  let next
  let n = 0
  while ((next = it.next()) && n++ < 750) {
    const sMs = next.toJSDate().getTime()
    if (sMs >= maxMs) break
    push(sMs, sMs + durMs)
  }
}

// caldavRequest — one WebDAV request via the runtime's global fetch, with basic auth. Returns
// { status, body }. fetch accepts arbitrary methods (REPORT, PROPFIND) and does not throw on
// 4xx/5xx (only on transport failure), so the status comes back for the callers to check.
async function caldavRequest(conn, method, url, body, contentType, depth) {
  const headers = {}
  if (contentType) headers['Content-Type'] = contentType
  if (depth != null) headers.Depth = String(depth)
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
    // freeBusy — REPORT calendar-query (Depth 1) → the window's VEVENTs → busy intervals. Uses
    // calendar-query rather than free-busy-query so it works on iCloud too (iCloud answers 400 to
    // free-busy-query on a calendar collection; calendar-query is universal).
    async freeBusy(conn, timeMin, timeMax) {
      const r = await caldavRequest(
        conn, 'REPORT', conn.url, calendarQuery(new Date(timeMin), new Date(timeMax)), XML, 1,
      )
      if (r.status >= 400) throw new Error(`caldav calendar-query: status ${r.status}`)
      return { busy: busyFromCalendarData(r.body, timeMin, timeMax) }
    },
    // insertEvent — PUT a VEVENT (UID idempotent).
    async insertEvent(conn, ev) {
      const uid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g, '')
      const url = `${conn.url.replace(/\/$/, '')}/${uid}.ics`
      const r = await caldavRequest(
        conn, 'PUT', url,
        vevent(
          uid, ev.summary, new Date(ev.start), new Date(ev.end),
          ev.visitor_email || ev.visitorEmail, ev.description,
        ), ICS,
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

module.exports = { apply, calendarQuery, busyFromCalendarData }
