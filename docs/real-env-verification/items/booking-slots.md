# booking-slots — Booking: list_slots vs real freeBusy

- **Status:** ⬜ not-run
- **Module:** the booker returns only genuinely-free slots inside the requested window, filtered against the account's real calendar busy/free.
- **Surface:** visitor chat (slot listing) / booker tool.
- **Real dep:** real `www.googleapis.com/calendar/v3` freeBusy on a connected account (see [[calendar-connect]]).
- **Backing e2e:** `visitor-chat-list-slots`.

## Checks

### 1 — `list_slots` vs real freeBusy  (was §B2)
- **Steps:** visitor chat asks for slots / call the booker directly with a real `timeMin/timeMax` window; compare against the account's real Google Calendar busy/free.
- **Expected:** only real free slots returned, and the **window is really filtered**.
- **⚠️ mock gap:** the mock ignores `timeMin/timeMax` (`gcal.go:390`) → window filtering never truly verified.
- **Backing test:** `visitor-chat-list-slots.spec.ts`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The slot list renders real times (not empty, not garbled); weekend/policy-excluded windows don't appear.

## Findings
(record here; also log `../findings.md`, ID `F-B-n` historical anchor)
