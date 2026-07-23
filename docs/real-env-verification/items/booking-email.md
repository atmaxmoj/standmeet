# booking-email — Booking: confirmation invite email

- **Status:** 🟡 blocked-by-setup — needs calendar + mail connected; e2e-covered
- **Module:** a confirmed booking sends a real invite/confirmation email (Google `sendUpdates` and/or the app's HTML+schema.org confirmation), and nothing is sent when the visitor declines.
- **Surface:** visitor chat (book-with-confirmation) → a real inbox.
- **Real dep:** real Google Calendar (see [[calendar-connect]]) + real mail (see [[mail-connector]]) + a real readable inbox.
- **Backing e2e:** `booking-confirmation-email` · `connector-send-confirmation-tool`.

## Checks

### 1 — send_confirmation actually sends the invite email  (was §B6)
- **Steps:** book with confirmation → real `sendUpdates` makes Google send an invite; confirm receipt in the real inbox.
- **Prereq:** pairs with [[mail-connector]].
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs calendar + mail connected. Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — Booking confirmation email (HTML + schema.org)  (was §C3)
- **Steps:** book through chat with confirmation → `send_confirmation` mails the HTML + schema.org confirmation to the session/profile email through real Gmail SMTP → confirm receipt and that the HTML renders in a real client.
- **Expected:** a well-formed confirmation email arrives; schema.org markup intact; nothing sent when the visitor declines.
- **Backing test:** `booking-confirmation-email.spec.ts:49` · `connector-send-confirmation-tool.spec.ts:46`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs calendar + mail connected. Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The in-chat confirmation copy matches what the email says; a declined booking shows no "email sent" affordance.

## Findings
(record here; also log `../findings.md`, ID `F-B-n` / `F-C-n` historical anchor)
