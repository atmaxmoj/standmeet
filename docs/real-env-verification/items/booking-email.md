# booking-email — Booking: confirmation invite email

- **Status:** 🟠 partial (2026-07-23) — booking succeeded; the agent stated the invite goes to the visitor email (bookgo.tester@example.com). Mail connector is connected + real-send proven (B). The invite/confirmation SEND path (Google sendUpdates / app HTML confirmation) not separately opened this round, but both enablers (calendar+mail) are live.
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
### 3 — The confirmation card has an in-flight state
- **Steps:** run a real booking through to the confirmation card in chat → fill the recipient → press send → **watch the card** from the press to the outcome, without looking at server logs. Do it once more when the machine is under load. Run both outcomes: success → the card should end at `confirmation sent`; failure (disconnect the mail connector) → see what the card says.
- **Expected:** `sending…` appears **immediately** on press and stays until the outcome lands — **both paths must clear it** (a `sending…` left behind is worse than none: it promises a result that never comes). On failure the card gives a reason, not a blank and not a spinner forever.
- **⚠️ what this fixes:** before this, pressing the button only greyed it out. This step starts a sandbox to assemble the capability — about a second when idle, but **measured at 19 seconds with the machine loaded** (which is what `slowAssembleThreshold` in `public/tools.go` now warns about). Nineteen silent seconds and the visitor concludes it didn't register and presses again — the idempotency marker prevents a duplicate mail, but what he sees is still a dead button.
- **⚠️ mock gap:** the e2e only asserts the element *was visible*; the real gap is **perception over time** — in CI that step is milliseconds, `sending…` flashes and is gone, so "what does a visitor see during 19 seconds" is structurally out of reach. This card is also HTML served by the MCP server and rendered in an iframe (`mcp-servers/booker/content.go`), not a frontend component — styling and placement have no component test.
- **Also:** while running this, look for `visitor tool assemble slow` in the backend log (only logged above 2s). It is the observability added for exactly this. If it never appears under real load, either the path wasn't taken or the instrumentation isn't wired.
- **Backing test:** `connector-send-confirmation-tool.spec.ts`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The in-chat confirmation copy matches what the email says; a declined booking shows no "email sent" affordance. Pressing send produces **visible** progress, not just a greyed button.

## Findings
(record here; also log `../findings.md`, ID `F-B-n` / `F-C-n` historical anchor)
