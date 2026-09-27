# release-smoke — the core features, after every release

- **Module:** After a release reaches the live instance, a visitor can still do what the product is for: be let in by a code, get answers grounded in the owner's corpus, book a meeting that lands on the real calendar, and get the email the chat promised. The owner is told about the booking, and the event bus carried every step. Driven by hand in the owner's Chrome, with a code issued for this run only.
- **Surface:** `https://sijie.xyz/?code=<selftest code>` as the visitor; `/admin/tasks` and `/admin/codes` as the owner; the owner's Gmail web view; the owner's Google Calendar web view.
- **Real dep:** The live instance at the released version, its connected Google Calendar, its mail supplier, a real model, and the owner's Gmail inbox.
- **Exclusive:** google-calendar · gmail-inbox
- **Backing e2e:** `chat-book-success` · `supplier-send-confirmation-tool` · `booking-owner-notify` · `events-side-effects-durable` · `events-index-via-bus` · `tasks-panel` — each covers one step below on the mock stack; this item is the same path on the real one.

## Checks

### 1 — The instance runs the released version
- **Steps:** Ask the owner MCP `instance.upgrade_check`. Read `current`.
- **Expected:** `current` equals the tag just released, and `available` is false.
- **Backing test:** `upgrade-events-outbox.spec.ts`

### 2 — A selftest code lets a visitor in
- **Steps:** Issue a code on the `invited` role with the `selftest` bundle, two members, expiring the same day. Open the site with `?code=` in a new Chrome tab. Type a name and a `+selftest` alias of the owner's Gmail address. Press Start.
- **Expected:** The chat greets the visitor by the name typed and names the code's label.
- **Backing test:** `gate-code-ux.spec.ts` · `access-codes.spec.ts`

### 3 — A question is answered from the owner's corpus ⭐
- **Steps:** Ask "What has Sijie been building recently?". Wait for the answer. Read the notes it says it read.
- **Expected:** The answer names real projects from the corpus in the owner's voice, and the notes it read belong to the owner's wiki. An answer that could be written without the corpus fails this check.
- **Backing test:** `transcript-grounding-visible.spec.ts` · see [[chat-grounding]]

### 4 — A booking lands on the real calendar ⭐
- **Steps:** Ask to book a 30-minute call at a named free slot next week. Wait for the booking card. Open Google Calendar in its own tab at that day. Open the event.
- **Expected:** The event is there at the booked time, and its guest list holds the `+selftest` address.
- **Backing test:** `chat-book-success.spec.ts` · see [[booking-book]]

### 5 — The confirmation email arrives
- **Steps:** In the booking card, send the confirmation to the profile address. Open the owner's Gmail in its own tab. Search for the `+selftest` address.
- **Expected:** A confirmation for this booking is in the inbox, addressed to the `+selftest` alias.
- **Backing test:** `supplier-send-confirmation-tool.spec.ts` · see [[booking-email]]

### 6 — The owner is told about the booking
- **Steps:** In the same inbox, search for "New booking".
- **Expected:** A "New booking" mail for this booking's topic, sent after the booking, is in the owner's inbox.
- **Backing test:** `booking-owner-notify.spec.ts` · `events-side-effects-durable.spec.ts`

### 7 — The event bus carried the booking
- **Steps:** Open `/admin/tasks`. Open the event stream. Find the `booking.created` event for this booking. Open it.
- **Expected:** The event lists its subscribers, and each subscriber's job reads completed. The overview shows no alert.
- **Backing test:** `tasks-panel.spec.ts` · `events-side-effects-durable.spec.ts`

### 8 — Cancelling removes the event
- **Steps:** Cancel the booking by its booking id through the owner MCP. Reload the calendar day.
- **Expected:** The event is gone from the calendar.
- **Backing test:** `tool-calendar-cancel-booking.spec.ts`

### 9 — The selftest code is revoked
- **Steps:** Revoke the code through the owner MCP. Open the site with the same `?code=` in a new tab.
- **Expected:** The code is refused in readable words, and no chat opens.
- **Backing test:** `access-codes.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

- The booking card's time reads in the visitor's zone, and the calendar event sits at the same instant in the owner's zone.
- What the chat says about email matches what the inbox holds — no "sent" without a message behind it.
- The Tasks overview numbers agree with the event and job rows below them.
