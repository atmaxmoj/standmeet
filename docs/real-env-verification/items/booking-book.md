# booking-book — Booking: book / cancel / reschedule across dispatch paths

- **Status:** ✅ VERIFIED end-to-end (2026-07-23) — the agent called calendar_book and created a REAL event: 'BookGo — Intro chat — recursion and cybernetics', Tue Jul 28 2026 1:00–1:30 PM EDT. **Confirmed present on the actual Google Calendar (calendar.google.com day view).** Full real path: visitor chat → agent → calendar_book → connected Google Calendar connector → real event.
- **Module:** a booking actually lands on the real calendar (and cancel deletes / reschedule moves the same event), quota is enforced against real accumulating events, a duplicate-id insert hits real 409, and the same real booking path is reached whether dispatched from chat reasoning or the API-key facade.
- **Surface:** visitor chat (book via reasoning) + API-key facade.
- **Real dep:** real Google Calendar on a connected account (see [[calendar-connect]]) + real DeepSeek (chat-book) + an outward API key (facade-book).
- **Backing e2e:** `chat-book-success` · `chat-book-conflict-{busy,policy-hours,policy-leadtime,policy-weekend}` · `chat-book-quota-exhausted` · `tool-calendar-cancel-booking` · `connector-calendar-cancel-tool` · `visitor-cancel-booking` · `tool-endpoint-calendar-book`.

## Checks

### 1 — `calendar_book` → event actually appears in Google  (was §B3)
- **Steps:** run one booking through chat → open the account's Google Calendar and confirm the event was created (title/time/attendees).
- **Expected:** the event appears in Google Calendar.
- **Backing test:** `chat-book-success.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — cancel → event actually deleted  (was §B4)
- **Steps:** cancel the booking → confirm the event is gone from Google Calendar.
- **Backing test:** `tool-calendar-cancel-booking.spec.ts` · `connector-calendar-cancel-tool.spec.ts` · `visitor-cancel-booking.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 3 — reschedule → event actually moved  (was §B5)
- **Steps:** reschedule → confirm the time changed in Google Calendar (same event, not a new one).
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 4 — `max_bookings` quota (real events)  (was §B8)
- **Steps:** book up to the quota with real events accumulating; over-limit should be refused.
- **Backing test:** `chat-book-quota-exhausted.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 5 — duplicate-id insert → real Google returns 409 ⭐  (was §B9)
- **Steps:** provoke a "same event id inserted twice" (e.g. the reconnect-retry path) → observe real Google's response.
- **Expected (likely RED):** real Google returns **409**, and the **backend has zero 409 handling**. CI's mock returns an idempotent 200 (`gcal.go:279`), masking it — the "no double-book after reconnect" CI proves would break live.
- **Backing test:** idempotency/retry specs (`connector-retry-*`) — focus here at attribution.
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 6 — Booking via chat (real reasoning → `calendar_book`)  (was §A9)
- **Steps:** visitor asks to book a slot in natural language → real model reasons through list-slots → `calendar_book`.
- **Expected:** the model selects a sane slot and books it without a scripted tool queue.
- **Backing test:** `tool-endpoint-calendar-book.spec.ts:62`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 7 — Real booking via API-key facade  (was §J3)
- **Steps:** on a key with a booking capability opened, dispatch a booking tool through the facade → confirm the event actually lands in the connected real calendar.
- **Expected:** the facade path can book against a real connector, honoring policy/quota exactly as the chat path does.
- **⚠️ mock gap:** `api-key-facade.spec.ts` only dispatches a **corpus** tool — there is **no booking-via-key case** in the facade suite (gap).
- **Backing test:** no dedicated facade-booking spec (gap); nearest `api-key-facade.spec.ts:154` (generic dispatch) + booking specs.
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected Google Calendar (not connected on this instance). Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
A confirmed booking renders a friendly confirmation (not a raw tool result); a quota/conflict refusal reads human, not an error code.

## Findings
(record here; also log `../findings.md`, ID `F-B-n` / `F-A-n` / `F-J-n` historical anchor)
