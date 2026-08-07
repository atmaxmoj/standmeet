# booking-email — Booking: confirmation invite email

- **Module:** A confirmed booking sends a real invite or confirmation email — the calendar provider's own invite, the app's HTML confirmation carrying schema.org markup, or both. A declined booking sends nothing.
- **Surface:** Visitor chat, through the booking confirmation card, into a real inbox.
- **Real dep:** A real calendar connector (see [[calendar-connect]]), a real mail connector (see [[mail-connector]]), and an inbox you can read.
- **Backing e2e:** `booking-confirmation-email` · `connector-send-confirmation-tool`.

## Checks

### 1 — A confirmed booking puts an invite in a real inbox ⭐
- **Steps:** Book through chat and confirm. Open the real inbox. Find the invite. Open it in a real mail client.
- **Expected:** The invite arrives. Its time, title and attendees match the booking. The HTML renders in a real client and its schema.org markup is intact.
- **Backing test:** `booking-confirmation-email.spec.ts` · `connector-send-confirmation-tool.spec.ts`

### 2 — A declined booking sends nothing
- **Steps:** Start a booking and decline at the confirmation step. Watch the inbox.
- **Expected:** No mail arrives, and the chat offers no affordance claiming one was sent.
- **Backing test:** `connector-send-confirmation-tool.spec.ts`

### 3 — The send button shows progress from press to outcome ⭐
- **Steps:** Reach the confirmation card. Fill the recipient. Press send and watch the card, without reading server logs. Repeat with the machine under load. Then disconnect the mail connector and press send again.
- **Expected:** A sending state appears immediately on press and stays until an outcome lands. Both paths clear it: success ends at a sent state, failure ends at a reason. A sending state left behind is worse than none, because it promises a result that never comes.
- **Mock gap:** In CI this step takes milliseconds, so the state flashes and the spec can only assert it existed. What a visitor sees during a slow assembly is structurally out of reach there. The card is HTML served by the MCP server into an iframe, not a frontend component, so its styling and placement have no component test either.
- **Note:** The backend logs a slow-assemble warning above two seconds. While driving this, look for it. If it never appears under real load, either this path was not taken or the instrumentation is not wired.
- **Backing test:** `connector-send-confirmation-tool.spec.ts` (visibility only) · perception over time → `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The in-chat confirmation copy says the same thing the email says.
A declined booking shows no "email sent" affordance anywhere.
Pressing send produces visible progress — a greyed-out button is not progress, it is an absence.
