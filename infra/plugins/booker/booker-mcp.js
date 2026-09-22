// booker-mcp.js — the calendar.book block as a stdio-MCP server, in JS (cross-platform, no Go).
//
// Faithful port of mcp-servers/booker (Go, 11 files). The booking logic lives HERE in the sandbox;
// everything external goes through the FIXED reach-back vocabulary (gateway.js + the verbs below):
// calendar insert/delete/free_busy/can_perform via supplier.invoke, booking storage/quota via
// blockstore, owner meta via owner.meta, policy via blockconfig.get. Owns no data/credentials; reads
// the trusted session off the tool `_meta` (host-planted, never LLM-controlled). Result wire is
// byte-aligned with the old host so the frontend cards decode unchanged. Timezone/policy math uses
// luxon (IANA zones via the Node ICU) — the Go original embedded time/tzdata for the same reason.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const { DateTime } = require('luxon')
const { gwCall, callHost } = require('./gateway.js')

// ── constants ──
const minDurationMin = 15
const maxDurationMin = 180
const bookingsColl = 'bookings'
const confirmationsColl = 'confirmations'
const defaultSlotStepMin = 30
const maxSlotsReturned = 50
const slotHoldSeconds = 60
const listBookingsDefaultLimit = 50
const listBookingsMaxLimit = 200

// conflict reasons — byte-aligned with the old domain.BookConflict* (the frontend card decodes these).
const conflictAllBusy = 'all_busy'
const conflictLeadTime = 'lead_time'
const conflictWeekday = 'weekday_not_allowed'
const conflictHours = 'outside_hours'

// host fault categories — one-to-one with the host's hostop.Fault*.
const faultNotConfigured = 'not_configured'

const slotsCardURI = 'ui://booker/slots-card.html'
const bookedCardURI = 'ui://booker/booked-card.html'
const cardMIME = 'text/html'

// weekday3 — luxon weekday (1=Mon..7=Sun) → 3-letter lowercase.
const weekday3 = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' }

// ── booker-specific reach-back verbs (built on the shared gwCall) ──

async function gwSupplierInvoke(ownerID, seam, verb, args) {
  return gwCall('supplier.invoke', { owner_id: ownerID, seam, verb, args })
}
async function gwSupplierInvokeBackground(ownerID, seam, verb, args) {
  await gwCall('supplier.invoke', { owner_id: ownerID, seam, verb, args, background: true })
}
async function gwBlockstoreInsert(collection, doc) {
  const r = JSON.parse(await gwCall('blockstore.insert', { collection, doc }))
  return r.id || ''
}
// gwBlockstoreClaim — only one caller gets the key (host guarantees via primary-key conflict). A host
// error is allowed through (true): a claim hiccup must not take booking down entirely (F-B-15 note).
async function gwBlockstoreClaim(collection, key, ttlSeconds) {
  try {
    const r = JSON.parse(await gwCall('blockstore.claim', { collection, key, ttl_seconds: ttlSeconds }))
    return typeof r.claimed === 'boolean' ? r.claimed : true
  } catch { return true }
}
async function gwBlockstoreRelease(collection, key) {
  try { await gwCall('blockstore.release', { collection, key }) } catch { /* TTL expires it */ }
}
async function gwBlockstoreQuery(collection, filter) {
  const r = JSON.parse(await gwCall('blockstore.query', { collection, filter }))
  return Array.isArray(r.records) ? r.records : []
}
async function gwBlockstoreCount(collection, filter) {
  const r = JSON.parse(await gwCall('blockstore.count', { collection, filter }))
  return typeof r.count === 'number' ? r.count : 0
}
async function gwBlockstoreDelete(collection, filter) {
  const r = JSON.parse(await gwCall('blockstore.delete', { collection, filter }))
  return r.deleted || 0
}
async function gwBlockstoreQueryRecords(collection, filter) {
  const r = JSON.parse(await gwCall('blockstore.query_records', { collection, filter }))
  return Array.isArray(r.records) ? r.records : [] // each {id, doc}
}
async function gwBlockstoreDeleteByID(collection, recordID) {
  const r = JSON.parse(await gwCall('blockstore.delete_by_id', { collection, record_id: recordID }))
  return r.deleted || 0
}
async function gwBlockConfig(ownerID) {
  return JSON.parse(await gwCall('blockconfig.get', { owner_id: ownerID }))
}
async function gwOwnerMeta(ownerID, field) {
  try {
    const r = JSON.parse(await gwCall('owner.meta', { owner_id: ownerID, field }))
    return typeof r.value === 'string' ? r.value : ''
  } catch { return '' }
}

const faultCode = (err) => (err && err.hostCode) || ''

// ── policy (ported from policy.go) ──

function leadTimeOK(startDT, minLeadDays) {
  let threshold = DateTime.now()
  if (minLeadDays > 0) threshold = threshold.plus({ days: minLeadDays })
  return startDT >= threshold
}
function zoneOrUTC(name) {
  return (name && name.trim()) ? name : 'utc'
}
function parseHHMM(s) {
  const parts = String(s).split(':')
  if (parts.length !== 2) return null
  const h = Number(parts[0]); const m = Number(parts[1])
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}
const minuteOfDay = (dt) => dt.hour * 60 + dt.minute

// evaluatePolicy — returns {conflict, missingHours}. conflict '' = passes. missingHours=true when
// working_hours is unset/broken (distinct from "outside hours").
function evaluatePolicy(policy, ownerTZ, startDT, durationMin) {
  if (!leadTimeOK(startDT, policy.min_lead_days || 0)) return { conflict: conflictLeadTime }
  const zone = zoneOrUTC(ownerTZ)
  const local = startDT.setZone(zone)
  if (!local.isValid) return { conflict: '', missingHours: false, tzErr: true }
  const end = startDT.plus({ minutes: durationMin }).setZone(zone)
  if (!weekdayAllowed(local.weekday, policy.allowed_weekdays || [])) return { conflict: conflictWeekday }
  const startMin = parseHHMM(policy.working_hours_start)
  const endMin = parseHHMM(policy.working_hours_end)
  if (startMin === null || endMin === null) return { conflict: '', missingHours: true }
  if (minuteOfDay(local) < startMin || minuteOfDay(end) > endMin || end.day !== local.day) {
    return { conflict: conflictHours }
  }
  return { conflict: '' }
}
function weekdayAllowed(luxonWeekday, allowed) {
  const want = weekday3[luxonWeekday]
  return allowed.some((w) => String(w).toLowerCase() === want)
}
function policyHint(policy, ownerTZ) {
  const tz = ownerTZ || 'UTC'
  return `${(policy.allowed_weekdays || []).join(',').toUpperCase()} ` +
    `${policy.working_hours_start}–${policy.working_hours_end} ${tz}`
}

// ── wire helpers (byte-aligned with book.go) ──

const mustJSON = (v) => { try { return JSON.stringify(v) } catch { return '{"ok":false,"error":"marshal_failed"}' } }
const bookErr = (reason, detail) => mustJSON({ ok: false, error: reason, detail })
function bookFailResult(conflict, hint, busy) {
  const out = { ok: false, conflict }
  if (hint) out.policy_hint = hint
  if (conflict === conflictAllBusy && busy && busy.length) {
    out.busy_windows = busy.map((b) => ({ start: rfc(b.start), end: rfc(b.end) }))
  }
  return mustJSON(out)
}
// rfc — a Date/DateTime/ISO string → RFC3339 UTC (matches Go time.Format(RFC3339) for UTC).
function rfc(v) {
  const dt = v instanceof DateTime ? v : DateTime.fromISO(typeof v === 'string' ? v : v.toISOString())
  return dt.toUTC().toISO({ suppressMilliseconds: true })
}
function friendlyCalErr(err) {
  if (faultCode(err) === faultNotConfigured || (err && /not connected/.test(err.message || ''))) {
    return bookErr('not_connected', 'owner has not connected a calendar yet')
  }
  return bookErr('calendar_unavailable',
    'the calendar service is temporarily unavailable — please try again later')
}

// ── free/busy + slots (slots.go) ──

async function loadPolicy(ownerID) {
  const values = await gwBlockConfig(ownerID) // already backfilled from the manifest declaration
  return { owner_id: ownerID, ...values }
}
async function gwFreeBusy(ownerID, fromDT, untilDT) {
  const resp = await gwSupplierInvoke(ownerID, 'calendar', 'free_busy',
    { time_min: rfc(fromDT), time_max: rfc(untilDT) })
  const busy = JSON.parse(resp)
  return (Array.isArray(busy) ? busy : []).map((b) => ({
    start: DateTime.fromISO(b.start), end: DateTime.fromISO(b.end),
  }))
}
function slotConflicts(startDT, durationMin, busy) {
  const end = startDT.plus({ minutes: durationMin })
  return busy.some((b) => startDT < b.end && end > b.start)
}
function enumerateSlots(policy, tz, input) {
  const step = input.stepMin > 0 ? input.stepMin : defaultSlotStepMin
  const out = []
  for (let t = input.from; t <= input.until && out.length < maxSlotsReturned; t = t.plus({ minutes: step })) {
    const end = t.plus({ minutes: input.durationMin })
    if (end > input.until) break
    const { conflict, missingHours, tzErr } = evaluatePolicy(policy, tz, t, input.durationMin)
    if (!missingHours && !tzErr && conflict === '') out.push({ start: t, end })
  }
  return out
}
async function listAvailableSlots(ownerID, input) {
  const policy = await loadPolicy(ownerID)
  const tz = await gwOwnerMeta(ownerID, 'timezone')
  const candidates = enumerateSlots(policy, tz, input)
  if (candidates.length === 0) return []
  const busy = await gwFreeBusy(ownerID, input.from, input.until)
  return candidates.filter((s) => !slotConflicts(s.start, input.durationMin, busy))
}
async function ownerCanBook(ownerID) {
  try {
    const r = JSON.parse(await gwSupplierInvoke(ownerID, 'calendar', 'can_perform', { operation: 'events.insert' }))
    return r.can === true
  } catch { return false }
}
async function ownerCanEmail(ownerID) {
  try {
    const r = JSON.parse(await gwSupplierInvoke(ownerID, 'mail', 'connected', null))
    return r.connected === true
  } catch { return false }
}

async function doListSlots(s, args) {
  if (!args.from_rfc3339 || !args.until_rfc3339) return bookErr('invalid_args', 'from_rfc3339 + until_rfc3339 required')
  if (!(args.duration_min >= minDurationMin && args.duration_min <= maxDurationMin)) {
    return bookErr('invalid_args', `duration_min must be ${minDurationMin}–${maxDurationMin}`)
  }
  const from = DateTime.fromISO(args.from_rfc3339)
  const until = DateTime.fromISO(args.until_rfc3339)
  if (!from.isValid || !until.isValid) return bookErr('invalid_args', 'from/until parse failed')
  try {
    const slots = await listAvailableSlots(s.ownerID,
      { from, until, durationMin: args.duration_min, stepMin: args.step_min || 0 })
    return mustJSON({
      ok: true,
      slots: slots.map((x) => ({ start: rfc(x.start), end: rfc(x.end) })),
      can_book: await ownerCanBook(s.ownerID),
    })
  } catch (e) { return friendlyCalErr(e) }
}

// ── book (book.go) ──

function buildSummary(visitorName, topic) {
  return [visitorName, topic].filter(Boolean).join(' — ')
}
// buildDescription — the event body the owner reads in their calendar, so a booking is never a
// mystery slot: what it's about, who it's with, and how to reach them. The calendar block escapes
// the text; newlines are fine.
function buildDescription(s, topic) {
  const lines = ['Booked via StandMeet.', `Topic: ${topic}`]
  if (s.visitorName) lines.push(`With: ${s.visitorName}`)
  if (s.visitorEmail) lines.push(`Contact: ${s.visitorEmail}`)
  return lines.join('\n')
}
function slotHoldKey(ownerID, startDT, endDT) {
  return `slot:${ownerID}:${rfc(startDT)}-${rfc(endDT)}`
}
function collectPassing(policy, tz, times, durationMin) {
  const passed = []; let worst = ''
  for (const t of times) {
    const { conflict, missingHours, tzErr } = evaluatePolicy(policy, tz, t, durationMin)
    if (missingHours || tzErr) continue
    if (conflict !== '') { worst = conflict; continue }
    passed.push(t)
  }
  return { passed, worst }
}
function pickFreeSlot(times, durationMin, busy) {
  for (const t of times) if (!slotConflicts(t, durationMin, busy)) return t
  return null
}
async function doBook(s, args) {
  if (!args.topic) return bookErr('invalid_args', 'missing topic')
  if (!(args.duration_min >= minDurationMin && args.duration_min <= maxDurationMin)) {
    return bookErr('invalid_args', `duration_min must be ${minDurationMin}–${maxDurationMin}`)
  }
  if (!Array.isArray(args.preferred_times) || args.preferred_times.length === 0) {
    return bookErr('invalid_args', 'preferred_times required')
  }
  const times = args.preferred_times.map((t) => DateTime.fromISO(t)).filter((d) => d.isValid)
  return runBook(s, args.topic, times, args.duration_min)
}
async function runBook(s, topic, times, durationMin) {
  let policy; let tz
  try { policy = await loadPolicy(s.ownerID); tz = await gwOwnerMeta(s.ownerID, 'timezone') } catch (e) { return friendlyCalErr(e) }
  const { passed, worst } = collectPassing(policy, tz, times, durationMin)
  if (passed.length === 0) return bookFailResult(worst, policyHint(policy, tz), null)
  let busy
  try { busy = await gwFreeBusy(s.ownerID, spanMin(passed), spanMax(passed, durationMin)) } catch (e) { return friendlyCalErr(e) }
  const slot = pickFreeSlot(passed, durationMin, busy)
  if (!slot) return bookFailResult(conflictAllBusy, policyHint(policy, tz), busy)
  return commitBooking(s, topic, tz, slot, durationMin)
}
function spanMin(times) { return times.reduce((a, b) => (b < a ? b : a), times[0]) }
function spanMax(times, durationMin) { return times.reduce((a, b) => (b > a ? b : a), times[0]).plus({ minutes: durationMin }) }

async function commitBooking(s, topic, tz, slot, durationMin) {
  const end = slot.plus({ minutes: durationMin })
  const summary = buildSummary(s.visitorName, topic)
  const holdKey = slotHoldKey(s.ownerID, slot, end)
  if (!(await gwBlockstoreClaim(bookingsColl, holdKey, slotHoldSeconds))) {
    return mustJSON({ ok: false, conflict: 'just_taken', detail: 'that time was taken a moment ago — pick another slot' })
  }
  let inserted
  try {
    inserted = await insertEvent(s, topic, tz, slot, end, summary)
  } catch (e) { await gwBlockstoreRelease(bookingsColl, holdKey); return friendlyCalErr(e) }
  try {
    await persistBooking(s, inserted, summary, slot, end)
  } catch (e) {
    await compensateDelete(s, inserted.event_id)
    await gwBlockstoreRelease(bookingsColl, holdKey)
    return friendlyCalErr(e)
  }
  await notifyOwnerOfBooking(s, {
    owner_id: s.ownerID, subject_id: s.subjectID, subject_kind: s.subjectKind,
    google_event_id: inserted.event_id, summary, visitor_email: s.visitorEmail, start_at: slot, end_at: end,
  })
  return mustJSON({
    ok: true, event_id: inserted.event_id, html_link: inserted.html_link,
    start: rfc(slot), end: rfc(end), invited_email: s.visitorEmail, can_email: await ownerCanEmail(s.ownerID),
  })
}
async function insertEvent(s, topic, tz, slot, end, summary) {
  const resp = await gwSupplierInvoke(s.ownerID, 'calendar', 'insert_event', {
    summary, description: buildDescription(s, topic), start: rfc(slot), end: rfc(end), time_zone: tz, visitor_email: s.visitorEmail,
  })
  const ev = JSON.parse(resp)
  return { event_id: ev.event_id || '', html_link: ev.html_link || '' }
}
async function persistBooking(s, ev, summary, startDT, endDT) {
  await gwBlockstoreInsert(bookingsColl, {
    owner_id: s.ownerID, subject_id: s.subjectID, subject_kind: s.subjectKind, conversation_id: s.conversationID,
    google_event_id: ev.event_id, google_html_link: ev.html_link, summary,
    visitor_email: s.visitorEmail, start_at: rfc(startDT), end_at: rfc(endDT),
  })
}
async function compensateDelete(s, eventID) {
  try { await gwSupplierInvoke(s.ownerID, 'calendar', 'delete_event', { event_id: eventID, attendee_email: s.visitorEmail }) } catch { /* best-effort */ }
}

// ── confirm (confirm.go) ──

function latestBooking(recs) {
  let latest = null
  for (const raw of recs) {
    const b = typeof raw === 'object' && raw.doc ? raw.doc : raw // query returns docs; query_records returns {id,doc}
    if (!b || !b.start_at) continue
    if (!latest || DateTime.fromISO(b.start_at) > DateTime.fromISO(latest.start_at)) latest = b
  }
  return latest || {}
}
function emailValid(addr) { return typeof addr === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function confirmationZone(visitorTZ, ownerTZ) {
  for (const name of [visitorTZ, ownerTZ]) {
    if (!name) continue
    const dt = DateTime.now().setZone(name)
    if (dt.isValid) return name
  }
  return 'utc'
}
function fmtWhen(startISO, zone) {
  return DateTime.fromISO(startISO).setZone(zone).toFormat("cccc, LLL d, yyyy '·' h:mm a ZZZZ")
}
function confirmationText(b, ownerName, when) {
  let body = `Hi,\n\nYour meeting is confirmed:\n\n  ${b.summary}\n  ${when}\n`
  if (b.google_html_link) body += `\nAdd it to your calendar: ${b.google_html_link}\n`
  return body + `\n— sent on behalf of ${ownerName}\n`
}
function confirmationCard(b, ownerName, when) {
  const link = b.google_html_link
    ? `<p style="margin:12px 0 0;font:12px monospace;"><a href="${esc(b.google_html_link)}" style="color:#B5391C;">open in google calendar →</a></p>`
    : ''
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td align="center" style="padding:32px 16px;">' +
    '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-left:3px solid #B5391C;padding:24px;">' +
    '<tr><td style="font:11px monospace;letter-spacing:0.16em;text-transform:uppercase;color:#9b8f80;">booking confirmed</td></tr>' +
    `<tr><td style="font:italic 20px Georgia,serif;color:#1B1814;padding:6px 0 4px;">${esc(b.summary)}</td></tr>` +
    `<tr><td style="font:13px monospace;color:#1B1814;">${esc(when)}</td></tr>` +
    `<tr><td>${link}</td></tr>` +
    `<tr><td style="font:11px monospace;color:#9b8f80;padding-top:16px;">— on behalf of ${esc(ownerName)}</td></tr>` +
    '</table></td></tr></table>'
}
function confirmationJSONLD(b, zone) {
  const ev = {
    '@type': 'Event', name: b.summary,
    startDate: DateTime.fromISO(b.start_at).setZone(zone).toISO({ suppressMilliseconds: true }),
    endDate: DateTime.fromISO(b.end_at).setZone(zone).toISO({ suppressMilliseconds: true }),
    url: b.google_html_link || undefined,
  }
  if (b.google_html_link) ev.location = { '@type': 'VirtualLocation', url: b.google_html_link }
  return mustJSON({
    '@context': 'https://schema.org', '@type': 'EventReservation',
    reservationStatus: 'https://schema.org/ReservationConfirmed',
    reservationNumber: b.google_event_id, reservationFor: ev,
  })
}
function confirmationHTML(b, ownerName, when, zone) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<script type="application/ld+json">${confirmationJSONLD(b, zone)}</script></head>` +
    `<body style="margin:0;background:#F3EFE6;">${confirmationCard(b, ownerName, when)}</body></html>`
}
function buildConfirmationEmail(b, ownerName, visitorTZ, ownerTZ) {
  const zone = confirmationZone(visitorTZ, ownerTZ)
  const when = fmtWhen(b.start_at, zone)
  return { subject: 'Confirmed: ' + b.summary, body: confirmationText(b, ownerName, when), html: confirmationHTML(b, ownerName, when, zone) }
}
function mailSendErr(err) {
  if (faultCode(err) === faultNotConfigured) return bookErr('mail_not_configured', "the owner hasn't set up email yet")
  return bookErr('mail_send_failed', "couldn't send the confirmation right now — the booking is still yours; try again in a bit")
}
async function doSendConfirmation(s, args) {
  let booking
  try {
    const recs = await gwBlockstoreQuery(bookingsColl, { conversation_id: s.conversationID })
    if (recs.length === 0) return bookErr('booking_not_found', 'no booking found for this conversation')
    booking = latestBooking(recs)
    if (booking.owner_id !== s.ownerID || booking.subject_id !== s.subjectID) {
      return bookErr('booking_not_found', 'no booking found for this conversation')
    }
  } catch { return bookErr('send_failed', "couldn't reach the booking — please try again later") }
  const to = args.recipient || s.visitorEmail
  if (!emailValid(to)) return bookErr('no_recipient', 'no email address to send the confirmation to')
  // idempotency: marker (one send per booking)
  try {
    if (await gwBlockstoreCount(confirmationsColl, { google_event_id: booking.google_event_id }) > 0) {
      return bookErr('already_sent', 'confirmation already sent for this booking')
    }
    await gwBlockstoreInsert(confirmationsColl, { google_event_id: booking.google_event_id, conversation_id: booking.conversation_id })
  } catch { return bookErr('send_failed', "couldn't send the confirmation right now — please try again later") }
  const ownerName = await gwOwnerMeta(s.ownerID, 'full_name')
  const ownerTZ = await gwOwnerMeta(s.ownerID, 'timezone')
  const msg = buildConfirmationEmail(booking, ownerName, args.tz || '', ownerTZ)
  msg.to = to
  try {
    await gwSupplierInvoke(s.ownerID, 'mail', 'send', msg)
  } catch (e) {
    try { await gwBlockstoreDelete(confirmationsColl, { google_event_id: booking.google_event_id }) } catch { /* release */ }
    return mailSendErr(e)
  }
  return '{"ok":true}'
}

// ── owner notify (owner_notify.go) ──

async function notifyOwnerOfBooking(s, b) {
  if (!s.notifyOwner) return
  try {
    const to = await gwOwnerMeta(s.ownerID, 'email')
    if (!to) return
    const ownerTZ = await gwOwnerMeta(s.ownerID, 'timezone')
    const zone = confirmationZone('', ownerTZ)
    const when = fmtWhen(typeof b.start_at === 'string' ? b.start_at : rfc(b.start_at), zone)
    const who = s.visitorName || 'A visitor'
    const body = `New booking on your calendar:\n\n  ${b.summary}\n  with ${who}\n  ${when}\n`
    await gwSupplierInvokeBackground(s.ownerID, 'mail', 'send', { subject: 'New booking: ' + b.summary, body, to })
  } catch { /* best-effort: booking already succeeded */ }
}

// ── cancel / reschedule (cancel.go) ──

async function resolveConvBooking(s, eventID) {
  let recs
  try { recs = await gwBlockstoreQuery(bookingsColl, { conversation_id: s.conversationID }) } catch { return { err: bookErr('cancel_failed', "couldn't reach the booking right now — please try again later") } }
  if (recs.length === 0) return { err: bookErr('booking_not_found', 'no booking found to cancel') }
  const latest = latestBooking(recs)
  if (eventID && eventID !== latest.google_event_id) return { err: bookErr('booking_not_found', 'no matching booking to cancel') }
  return { booking: latest }
}
async function deleteBooking(ownerID, b) {
  await gwSupplierInvoke(ownerID, 'calendar', 'delete_event', { event_id: b.google_event_id, attendee_email: b.visitor_email })
  await gwBlockstoreDelete(bookingsColl, { conversation_id: b.conversation_id, google_event_id: b.google_event_id })
}
async function doCancel(s, args) {
  const { booking, err } = await resolveConvBooking(s, args.event_id || '')
  if (err) return err
  try { await deleteBooking(s.ownerID, booking) } catch { return bookErr('cancel_failed', "couldn't cancel the meeting right now — please try again later") }
  return '{"ok":true,"cancelled":true}'
}
async function doReschedule(s, args) {
  if (!Array.isArray(args.preferred_times) || args.preferred_times.length === 0) return bookErr('invalid_args', 'preferred_times required')
  if (!(args.duration_min >= minDurationMin && args.duration_min <= maxDurationMin)) return bookErr('invalid_args', `duration_min must be ${minDurationMin}–${maxDurationMin}`)
  const { booking: old, err } = await resolveConvBooking(s, args.event_id || '')
  if (err) return err
  const times = args.preferred_times.map((t) => DateTime.fromISO(t)).filter((d) => d.isValid)
  const s2 = { ...s, visitorName: '' } // topic carries the old summary; clear name to avoid a repeated prefix
  const wire = await runBook(s2, old.summary, times, args.duration_min)
  let ok = false; try { ok = JSON.parse(wire).ok === true } catch { ok = false }
  if (!ok) return wire // original untouched
  try { await deleteBooking(s.ownerID, old) } catch { /* best-effort: new one already succeeded */ }
  return wire
}

// ── owner-face cancel by id + list (cancel_owner.go / list_bookings.go) ──

async function doCancelByID(s, args) {
  if (!args.booking_id) return bookErr('invalid_args', 'booking_id is required')
  let rec
  try {
    const recs = await gwBlockstoreQueryRecords(bookingsColl, { owner_id: s.ownerID }) // owner_id in filter: a guessed id from someone else won't match
    rec = recs.find((r) => r.id === args.booking_id)
  } catch (e) { return bookErr('not_found', e.message) }
  if (!rec) return bookErr('not_found', 'booking not found')
  const doc = rec.doc
  try {
    await gwSupplierInvoke(s.ownerID, 'calendar', 'delete_event', { event_id: doc.google_event_id, attendee_email: doc.visitor_email })
    await gwBlockstoreDeleteByID(bookingsColl, rec.id)
  } catch (e) { return bookErr('cancel_failed', e.message) }
  return mustJSON({
    booking_id: args.booking_id, google_event_id: doc.google_event_id, summary: doc.summary,
    cancelled: true, sent_updates_to: doc.visitor_email,
  })
}
function clampListLimit(n) { return (!n || n <= 0) ? listBookingsDefaultLimit : Math.min(n, listBookingsMaxLimit) }
async function doListBookings(s, args) {
  const limit = clampListLimit(args && args.limit)
  let recs
  try { recs = await gwBlockstoreQueryRecords(bookingsColl, { owner_id: s.ownerID }) } catch (e) { return bookErr('list_failed', e.message) }
  const rows = recs.map((r) => ({
    id: r.id, start_at: rfc(r.doc.start_at), end_at: rfc(r.doc.end_at), summary: r.doc.summary,
    visitor_email: r.doc.visitor_email, subject_id: r.doc.subject_id, subject_kind: r.doc.subject_kind,
    conversation_id: r.doc.conversation_id,
    ...(r.doc.google_event_id ? { google_event_id: r.doc.google_event_id } : {}),
    ...(r.doc.google_html_link ? { google_html_link: r.doc.google_html_link } : {}),
  }))
  rows.sort((a, b) => (a.start_at > b.start_at ? -1 : a.start_at < b.start_at ? 1 : 0)) // newest first
  return mustJSON({ bookings: rows.slice(0, limit) })
}

// ── cards (content.go, verbatim) ──
const slotsCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 details{font:13px ui-serif,Georgia,serif}
 summary{cursor:pointer;list-style:none;padding:2px 0;user-select:none}
 summary::-webkit-details-marker{display:none}
 .kicker{font:600 12px ui-monospace,monospace;color:#6b5d4f}
 .cal{margin-top:8px;border-top:1px solid #d9d0c2;padding-top:8px}
 .days{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
 .day{padding:5px 9px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:12px ui-monospace,monospace}
 .day[aria-pressed=true]{background:#B5391C;color:#fff;border-color:#B5391C}
 .times{display:flex;flex-wrap:wrap;gap:6px}
 .chip{padding:6px 10px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:13px ui-serif,Georgia,serif}
 .chip:hover{background:#1B1814;color:#F3EFE6}
 .chip.readonly{border-color:#d9d0c2;color:#6b5d4f;cursor:default}
 .chip.readonly:hover{background:#F3EFE6;color:#6b5d4f}
 .empty{margin-top:8px;color:#6b5d4f;font-size:12px}
</style></head><body>
<script>
(function(){
 var byDay={}, order=[], sel="", canBook=true;
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function fmtDay(d){return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});}
 function fmtTime(d){return d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
 function slotZone(){
   try{
     var parts=new Intl.DateTimeFormat([],{timeZoneName:"short"}).formatToParts(new Date());
     for(var i=0;i<parts.length;i++){if(parts[i].type==="timeZoneName")return parts[i].value;}
   }catch(_){}
   return "your time";
 }
 function dayKey(d){return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();}
 function el(tag,cls,txt){var e=document.createElement(tag);
   if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;}
 function group(slots){
   byDay={}; order=[];
   slots.forEach(function(s){
     var st=new Date(s.start); if(isNaN(st.getTime()))return;
     var k=dayKey(st);
     if(!byDay[k]){byDay[k]={label:fmtDay(st),items:[]}; order.push(k);}
     byDay[k].items.push({start:st,end:new Date(s.end)});
   });
 }
 function renderTimes(host){
   host.innerHTML="";
   var day=byDay[sel]; if(!day)return;
   day.items.forEach(function(it){
     var label=fmtTime(it.start)+" – "+fmtTime(it.end);
     if(!canBook){
       var s=el("span","chip readonly",label);
       s.setAttribute("data-testid","tool-card-slot-readonly");
       host.appendChild(s);
       return;
     }
     var b=el("button","chip",label);
     b.setAttribute("data-testid","tool-card-slot");
     b.onclick=function(){
       parent.postMessage({type:"mcp-ui:submit",
         value:"book the "+day.label+" at "+fmtTime(it.start)+" slot"},"*");
     };
     host.appendChild(b);
   });
 }
 function render(slots){
   group(slots);
   var det=el("details"); det.open=true;
   det.setAttribute("data-testid","tool-card-calendar_list_slots");
   var sum=el("summary");
   var kick=el("span","kicker",(canBook?"available · ":"owner's free time · ")
     +slots.length+" slots · times in "+slotZone());
   kick.setAttribute("data-testid","bookings-kicker");
   sum.appendChild(kick); det.appendChild(sum);
   if(slots.length===0){
     det.appendChild(el("div","empty","no free slots in that window — try a different range."));
   } else {
     if(!canBook){
       var note=el("div","empty","this is when the owner is free — booking isn't switched on here.");
       note.setAttribute("data-testid","slots-readonly-note");
       det.appendChild(note);
     }
     sel=order[0];
     var cal=el("div","cal"); cal.setAttribute("data-testid","slot-calendar");
     var days=el("div","days");
     order.forEach(function(k){
       var b=el("button","day",byDay[k].label);
       b.setAttribute("data-testid","slot-day");
       if(k===sel)b.setAttribute("aria-pressed","true");
       b.onclick=function(){
         sel=k;
         days.querySelectorAll("button").forEach(function(x){x.removeAttribute("aria-pressed");});
         b.setAttribute("aria-pressed","true"); renderTimes(times); h();
       };
       days.appendChild(b);
     });
     var times=el("div","times"); times.setAttribute("data-testid","slot-times");
     cal.appendChild(days); cal.appendChild(times);
     det.appendChild(cal); renderTimes(times);
   }
   det.addEventListener("toggle",h);
   document.body.innerHTML=""; document.body.appendChild(det);
 }
 window.addEventListener("message",function(e){
   if(e.data&&e.data.type==="mcp-ui:data"){
     var d=e.data.data||{};
     canBook = d.can_book === true;
     render(Array.isArray(d.slots)?d.slots:[]); h();
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`

const bookedCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 .card{font:13px ui-serif,Georgia,serif;border:1px solid #d9d0c2;padding:10px;background:#F3EFE6}
 .kicker{font:600 11px ui-monospace,monospace;color:#6b5d4f;text-transform:uppercase;letter-spacing:.05em}
 .time{font:600 15px ui-serif,Georgia,serif;margin:4px 0}
 .link{display:inline-block;margin:2px 0 8px;color:#B5391C;text-decoration:underline}
 .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
 button{padding:5px 10px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:12px ui-monospace,monospace}
 button:hover:not(:disabled){background:#1B1814;color:#F3EFE6}
 button:disabled{opacity:.5;cursor:default}
 button.primary{background:#1B1814;color:#F3EFE6}
 button.primary:hover:not(:disabled){background:#000}
 button.quiet{border:0;background:none;padding:5px 2px;color:#6b5d4f;text-decoration:underline}
 button.quiet:hover:not(:disabled){background:none;color:#1B1814}
 button.danger{border:0;background:none;padding:5px 2px;color:#B5391C;text-decoration:underline}
 button.danger:hover:not(:disabled){background:none;color:#1B1814}
 .prompt{margin-top:10px;border-top:1px solid #d9d0c2;padding-top:8px}
 .label{font:12px ui-serif,Georgia,serif;margin-bottom:6px}
 input{padding:5px 7px;border:1px solid #1B1814;background:#fff;font:12px ui-monospace,monospace;flex:1;min-width:120px}
 .err{margin-top:6px;color:#B5391C;font-size:12px}
 .muted{color:#6b5d4f}
 .busy{color:#6b5d4f;font:12px ui-serif,Georgia,serif;margin-top:6px}
 .busy .dot{animation:sm-blink 1.1s infinite}
 .busy .dot:nth-child(2){animation-delay:.15s}
 .busy .dot:nth-child(3){animation-delay:.3s}
 @keyframes sm-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
 [data-cancelled=true] .time{text-decoration:line-through;color:#6b5d4f}
</style></head><body>
<script>
(function(){
 var seq=0, pending={}, statePending={};
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function el(tag,cls,txt){var e=document.createElement(tag);
   if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;}
 function fmt(s,e){
   var a=new Date(s), b=new Date(e);
   if(isNaN(a.getTime()))return "";
   var d=a.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
   var t=function(x){return x.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});};
   return d+" · "+t(a)+"–"+t(b)+" "+zoneOf(b);
 }
 function zoneOf(x){
   try{
     var parts=new Intl.DateTimeFormat([],{timeZoneName:"short"}).formatToParts(x);
     for(var i=0;i<parts.length;i++){if(parts[i].type==="timeZoneName")return parts[i].value;}
   }catch(_){}
   return "";
 }
 function callTool(name,args,cb){
   var id="t"+(++seq); pending[id]=cb;
   parent.postMessage({type:"mcp-ui:tool",name:name,args:args,requestId:id},"*");
 }
 function tz(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"";}catch(_){return "";}}
 function emailPrompt(d){
   var p=el("div","prompt"); p.setAttribute("data-testid","booking-email-prompt");
   p.setAttribute("data-sent","false");
   p.appendChild(el("div","label","Send a confirmation email?"));
   var row=el("div","row");
   var useProfile=el("button","primary","Use my email");
   useProfile.setAttribute("data-testid","booking-email-use-profile");
   var input=el("input"); input.setAttribute("data-testid","booking-email-other");
   input.placeholder="a different address";
   var sendTyped=el("button",null,"Send");
   sendTyped.setAttribute("data-testid","booking-email-send");
   var skip=el("button","quiet","No thanks");
   skip.setAttribute("data-testid","booking-email-skip");
   skip.onclick=function(){
     p.setAttribute("data-sent","true");
     p.innerHTML=""; p.appendChild(el("div","label muted","no confirmation sent"));
     h();
   };
   function send(recipient,btns){
     btns.forEach(function(b){b.disabled=true;});
     var busy=el("div","busy","sending");
     busy.setAttribute("data-testid","booking-email-sending");
     ["·","·","·"].forEach(function(c){busy.appendChild(el("span","dot",c));});
     p.appendChild(busy);
     function clearBusy(){ if(busy&&busy.parentNode) busy.parentNode.removeChild(busy); }
     callTool("send_confirmation",{recipient:recipient,tz:tz()},function(res){
       clearBusy();
       if(res&&res.ok){
         p.setAttribute("data-sent","true");
         p.innerHTML=""; p.appendChild(el("div","label muted","confirmation sent"));
       }else{
         btns.forEach(function(b){b.disabled=false;});
         var old=p.querySelector(".err"); if(old)old.remove();
         var em=el("div","err",(res&&(res.detail||res.error))||"couldn't send — try again");
         em.setAttribute("data-testid","booking-email-error");
         p.appendChild(em);
       }
       h();
     });
   }
   useProfile.onclick=function(){send("",[useProfile,sendTyped]);};
   sendTyped.onclick=function(){send(input.value,[useProfile,sendTyped]);};
   if(d.invited_email){ row.appendChild(useProfile); } else { sendTyped.className="primary"; }
   row.appendChild(input); row.appendChild(sendTyped);
   row.appendChild(skip);
   p.appendChild(row);
   return p;
 }
 function render(d,state){
   document.body.innerHTML="";
   if(!d||!d.ok)return;
   var root=el("div","card"); root.setAttribute("data-testid","tool-card-calendar_book");
   root.setAttribute("data-cancelled","false");
   var kick=el("div","kicker","booked"); root.appendChild(kick);
   var time=el("div","time",fmt(d.start,d.end)); time.setAttribute("data-testid","book-card-time");
   root.appendChild(time);
   if(d.html_link){
     var link=el("a","link","View on Google Calendar");
     link.setAttribute("href",d.html_link); link.setAttribute("target","_blank");
     link.setAttribute("rel","noopener"); link.setAttribute("data-testid","book-card-link");
     root.appendChild(link);
   }
   var inv=el("div","label muted",
     d.invited_email ? ("calendar invite emailed to "+d.invited_email)
                     : "no invite was emailed — this card is your only record");
   inv.setAttribute("data-testid","book-card-invite");
   root.appendChild(inv);
   var cancel=el("button","danger","Cancel meeting");
   cancel.setAttribute("data-testid","book-card-cancel");
   function toCancelled(){
     root.setAttribute("data-cancelled","true"); kick.textContent="cancelled";
     if(cancel.parentNode)cancel.remove();
     var pr=root.querySelector('[data-testid="booking-email-prompt"]'); if(pr)pr.remove();
     h();
   }
   cancel.onclick=function(){
     cancel.disabled=true;
     callTool("calendar_cancel",{event_id:d.event_id},function(res){
       if(res&&((res.ok&&res.cancelled)||res.error==="booking_not_found")){
         var rid="s"+(++seq); statePending[rid]=toCancelled;
         parent.postMessage(
           {type:"mcp-ui:state-set",key:d.event_id,value:{cancelled:true},requestId:rid},"*");
       } else { cancel.disabled=false; h(); }
     });
   };
   var crow=el("div","row"); crow.appendChild(cancel); root.appendChild(crow);
   if(d.can_email){ root.appendChild(emailPrompt(d)); }
   var st=state&&state[d.event_id];
   if(st&&st.cancelled){ toCancelled(); }
   document.body.appendChild(root); h();
 }
 window.addEventListener("message",function(e){
   var m=e.data||{};
   if(m.type==="mcp-ui:data"){ render(m.data||{}, m.state||{}); }
   else if(m.type==="mcp-ui:state-ack"){
     var scb=statePending[m.requestId];
     if(scb){ delete statePending[m.requestId]; scb(); }
   }
   else if(m.type==="mcp-ui:tool-result"){
     var cb=pending[m.requestId];
     if(cb){ delete pending[m.requestId]; cb(m.result||{}); }
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`

// instructions (content.go)
const instructions = `This is the owner's calendar. **Your tools decide what you can offer** — read the tool list you were given and offer only what is on it. Some of these tools are only present when the owner's calendar grant allows that action, so a tool that is absent is not one to promise, apologise for, or ask the visitor to wait for; simply do not raise it. Never tell the visitor you will do something you have no tool for.

1. **calendar_list_slots** — search a time window and get back the free [start, end] slots that pass the owner's booking policy. Pass \`from_rfc3339\`, \`until_rfc3339\`, and \`duration_min\`. Use this *before* offering times so you propose ones the owner actually has free.

Default flow when you can act on a time: ask topic + duration **and roughly when the visitor wants to meet** (a day or a window — don't guess it for them). Search a window around what they asked for, present 2-3 of the available slots in their local time, and wait for them to pick. Each tool's own description says what it needs and when to call it.

Timezones: the current date and time you were given runs in the **owner's** timezone — that is the zone the owner's calendar keeps. Interpret any time the visitor names in the visitor's own timezone, convert it to the owner's when you search or book, and state both the visitor-local and the owner-local time when you confirm. If you have not been told the visitor's timezone, ask for it before proposing times.

When the visitor's preferred time isn't free: don't keep hunting blindly. List the *nearest* available slots around what they asked and let them choose from those. Search at most a window or two near their request — if that comes back empty, tell the visitor plainly that there's nothing open in that period and ask them for a different timeframe to try. Never widen the search again and again (next week → next month → next year) or call calendar_list_slots over and over; a couple of empty windows means "ask the visitor for a new timeframe," not "search harder."`

// session from _meta
function sessionFrom(extra) {
  const raw = (extra && extra._meta && extra._meta['standmeet/session']) || {}
  const cfg = (raw.block_config && typeof raw.block_config === 'object') ? raw.block_config : {}
  return {
    ownerID: raw.owner_id || '', subjectID: raw.subject_id || '', subjectKind: raw.subject_kind || '',
    conversationID: raw.conversation_id || '', visitorName: raw.visitor_name || '', visitorEmail: raw.visitor_email || '',
    roleID: raw.role_id || '', notifyOwner: cfg.notify_owner === true,
  }
}
// localHandler — run a block fn with the trusted session; return its wire JSON straight through.
function localHandler(fn) {
  return async (args, extra) => {
    try { return { content: [{ type: 'text', text: await fn(sessionFrom(extra), args || {}) }] } }
    catch (e) { return { content: [{ type: 'text', text: bookErr('internal', e.message) }] } }
  }
}

async function main() {
  const server = new McpServer(
    { name: 'booker', version: '1.0.0' },
    { instructions, capabilities: { tools: {}, resources: {} } },
  )

  server.registerTool('calendar_book', {
    description:
      "Create the meeting on the owner's Google Calendar. Only call after you have gathered topic, " +
      'duration (15-180 minutes), and one or more visitor-confirmed preferred start times in RFC3339 ' +
      'format. The invite goes to the email the visitor gave when they entered (if any) — you do not ' +
      'supply a recipient; the result tells you what happened. Read `invited_email` on the result and ' +
      'say exactly that: if it holds an address, the invite went there; if it is empty, nobody was ' +
      'invited — say so plainly ("no invite could be emailed, so keep a note of the time yourself") ' +
      'and offer the confirmation-email widget on the card. Never name an address the result did not ' +
      'give you, even one the visitor typed earlier in the conversation — an address in the transcript ' +
      'is not a recipient the booking used. Usual flow: gather topic, duration and roughly when they ' +
      'want to meet, list the free slots, let the visitor pick one, then call this with that single ' +
      'confirmed time.',
    inputSchema: {
      topic: z.string(),
      duration_min: z.number().int().min(minDurationMin).max(maxDurationMin),
      preferred_times: z.array(z.string()).min(1),
    },
    _meta: { progress_label: 'booking meeting', ui_resource: bookedCardURI },
  }, localHandler(doBook))

  server.registerTool('calendar_list_slots', {
    description:
      'List available [start, end] slots on the owner\'s calendar between from_rfc3339 and until_rfc3339 ' +
      "that pass booking policy and don't overlap any busy window. Returns up to 50 slots. Use this " +
      'before calendar_book so the visitor can pick an actual free time. The result renders for the ' +
      'visitor as a slot picker, so do NOT re-list the times in your reply — the card already shows ' +
      'them, and a second partial list contradicts it. Say what the picker is and let them pick; ' +
      'naming one specific time is fine when answering about that time. Read `can_book` on the result: ' +
      'it says whether a time picked here can actually be booked. When it is false the picker is ' +
      'read-only — it shows when the owner is free and nothing more. Then do not offer to book, do not ' +
      'tell the visitor to tap a slot, and do not say it will be confirmed; say plainly that booking is ' +
      'not available here and give them the times.',
    inputSchema: {
      from_rfc3339: z.string(), until_rfc3339: z.string(),
      duration_min: z.number().int().min(minDurationMin).max(maxDurationMin),
      step_min: z.number().int().min(15).max(120).optional(),
    },
    annotations: { readOnlyHint: true },
    _meta: { progress_label: 'listing slots', ui_resource: slotsCardURI },
  }, localHandler(doListSlots))

  server.registerTool('send_confirmation', {
    description:
      'Send the booking confirmation email for the meeting just booked in this conversation. This is ' +
      "triggered by the booking card's email widget — the recipient is the visitor's session email " +
      'unless they typed a different one. You do not normally call this directly; the card drives it.',
    inputSchema: {
      recipient: z.string().optional().describe("Override recipient address; empty uses the visitor's session email."),
      tz: z.string().optional().describe('Visitor IANA timezone for rendering body times.'),
    },
    _meta: { progress_label: 'sending confirmation' },
  }, localHandler(doSendConfirmation))

  server.registerTool('calendar_cancel', {
    description:
      'Cancel the meeting just booked in this conversation. This is triggered by the booking card\'s ' +
      'cancel button — it removes the calendar event for the booking the visitor made here. You do not ' +
      'normally call this directly.',
    inputSchema: { event_id: z.string().optional().describe("The booking's google_event_id from the card.") },
    _meta: { progress_label: 'cancelling booking' },
  }, localHandler(doCancel))

  server.registerTool('calendar_reschedule', {
    description:
      'Move the meeting booked in this conversation to a new time. Provide the booking\'s event_id ' +
      '(from the card) plus the duration and one or more visitor-confirmed new preferred start times ' +
      "(RFC3339). The new slot must be free and pass the owner's booking policy; if not, the original " +
      'booking stays and you get the conflict back.',
    inputSchema: {
      event_id: z.string().optional().describe("The booking's google_event_id from the card."),
      duration_min: z.number().int().min(minDurationMin).max(maxDurationMin),
      preferred_times: z.array(z.string()).min(1),
    },
    _meta: { progress_label: 'rescheduling meeting', ui_resource: bookedCardURI },
  }, localHandler(doReschedule))

  server.registerTool('calendar_cancel_booking', {
    description:
      "Cancel one of the owner's bookings by its booking id: removes the calendar event and the stored " +
      'booking record.',
    inputSchema: { booking_id: z.string().describe('The booking record id.') },
  }, localHandler(doCancelByID))

  server.registerTool('bookings_list', {
    description: "List the owner's confirmed bookings, newest first, each with its booking id.",
    inputSchema: { limit: z.number().int().optional().describe('Max rows (default 50, max 200).') },
    annotations: { readOnlyHint: true },
  }, localHandler(doListBookings))

  server.registerResource('slots card', slotsCardURI,
    { mimeType: cardMIME, description: 'Sandboxed calendar_list_slots day picker.' },
    async () => ({ contents: [{ uri: slotsCardURI, mimeType: cardMIME, text: slotsCardHTML }] }))
  server.registerResource('booked card', bookedCardURI,
    { mimeType: cardMIME, description: 'Sandboxed calendar_book confirmation (cancel / send-confirmation).' },
    async () => ({ contents: [{ uri: bookedCardURI, mimeType: cardMIME, text: bookedCardHTML }] }))

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
