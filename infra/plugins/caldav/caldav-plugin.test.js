// caldav-plugin.test.js — self-contained checks for busyFromCalendarData, the availability read
// that replaced free-busy-query (which iCloud rejects with HTTP 400). Run: `node caldav-plugin.test.js`.
//
// It feeds calendar-query multistatus bodies (the 207 shape iCloud/Fastmail/Radicale return) and
// asserts the busy intervals computed from the VEVENTs. No network, no host — pure parse logic.

const assert = require('assert')
const { busyFromCalendarData } = require('./caldav-plugin')

const WIN = { min: '2026-09-22T00:00:00Z', max: '2026-10-06T00:00:00Z' }

// a calendar-query 207 multistatus with one <calendar-data> per response, iCloud-style.
const multistatus = (...icals) =>
  '<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  icals.map((ics) => `<response><href>/x.ics</href><propstat><prop><C:calendar-data>${ics}</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join('') +
  '</multistatus>'

const vevent = (extra) =>
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Busy\r\n' +
  'DTSTART:20260923T140000Z\r\nDTEND:20260923T150000Z\r\n' + (extra || '') + 'END:VEVENT\r\nEND:VCALENDAR\r\n'

// 1) a plain event → exactly one busy interval matching its DTSTART/DTEND.
{
  const busy = busyFromCalendarData(multistatus(vevent()), WIN.min, WIN.max)
  assert.strictEqual(busy.length, 1, 'one event → one interval')
  assert.strictEqual(busy[0].start, '2026-09-23T14:00:00.000Z')
  assert.strictEqual(busy[0].end, '2026-09-23T15:00:00.000Z')
}

// 2) a TRANSPARENT event (marked "free") → not busy.
{
  const busy = busyFromCalendarData(multistatus(vevent('TRANSP:TRANSPARENT\r\n')), WIN.min, WIN.max)
  assert.strictEqual(busy.length, 0, 'transparent event does not block')
}

// 3) empty calendar (207, zero calendar-data) → free, not an error.
{
  const busy = busyFromCalendarData('<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>', WIN.min, WIN.max)
  assert.strictEqual(busy.length, 0, 'no events → free')
}

// 4) a weekly recurring event → one occurrence per week inside the 2-week window.
{
  const rec = vevent('RRULE:FREQ=WEEKLY;COUNT=8\r\n')
  const busy = busyFromCalendarData(multistatus(rec), WIN.min, WIN.max)
  assert.ok(busy.length === 2, `weekly recurrence → 2 in window, got ${busy.length}`)
  assert.strictEqual(busy[0].start, '2026-09-23T14:00:00.000Z')
  assert.strictEqual(busy[1].start, '2026-09-30T14:00:00.000Z')
}

// 5) calendar-data present but unparseable → throws (unreadable ≠ empty).
{
  assert.throws(
    () => busyFromCalendarData(multistatus('this is not ical BEGIN:VCALENDAR \x00 broken'), WIN.min, WIN.max),
    /unreadable|parse/i,
    'garbage calendar-data must throw, never silently report free',
  )
}

console.log('caldav-plugin.test.js: all checks passed')
