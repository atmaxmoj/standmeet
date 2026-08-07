# booking-slots — Booking: list_slots vs real freeBusy

- **Module:** The booker returns only genuinely free slots inside the requested window, filtered against the account's real calendar.
- **Surface:** Visitor chat, on a code whose role grants the booking tool.
- **Real dep:** A connected real calendar account (see [[calendar-connect]]) with known busy blocks. Also a role that grants `calendar.book` — see the Note below, because without it the tools never assemble.
- **Backing e2e:** `visitor-chat-list-slots`.

## Checks

### 1 — Only genuinely free times are offered ⭐
- **Steps:** Put a known busy block on the real calendar. Ask for slots covering that period. Compare the offered slots against the calendar.
- **Expected:** No offered slot overlaps a busy block. Times the calendar shows free are offered.
- **Backing test:** `visitor-chat-list-slots.spec.ts`

### 2 — The requested window is really filtered
- **Steps:** Ask for slots inside a narrow window. Read every slot returned.
- **Expected:** Every slot falls inside the window. None comes from outside it.
- **Mock gap:** The mock ignores the window bounds entirely, so window filtering has never been verified against anything that enforces it.
- **Backing test:** `visitor-chat-list-slots.spec.ts` (mock ignores the window)

### 3 — Policy exclusions hold
- **Steps:** Set the booking policy to weekdays only with a minimum lead time. Ask for slots spanning a weekend and starting today.
- **Expected:** No weekend slot appears. No slot falls inside the lead time.
- **Backing test:** `gap`

### 4 — Times are proposed in the visitor's timezone
- **Steps:** Ask for slots from a client in a timezone different from the owner's. Read how the times are stated.
- **Expected:** Slots are proposed in the visitor's timezone, unambiguously, so the visitor does not have to convert.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The slot list renders real times, never empty and never garbled.
Excluded windows do not appear at all, rather than appearing and failing on booking.
Every time carries its zone, because a bare clock time is ambiguous to anyone not in the owner's zone.

## Note

The booker assembles into a visitor session only when the session role's granted tools include
`calendar.book`. A connected calendar and an enabled capability are necessary but not sufficient.
A visitor on a stock role correctly sees no booking tools — read the role before calling that a
defect. Whether an owner can grant it through the GUI at all is tracked as `F-B-4`.
