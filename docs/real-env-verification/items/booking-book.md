# booking-book — Booking: book / cancel / reschedule across dispatch paths

- **Module:** A booking lands on the real calendar. Cancelling deletes that event and rescheduling moves it rather than creating a second one. Quota is enforced against real accumulating events, and the same real path is reached whether the request comes from chat reasoning or from the outward API.
- **Surface:** Visitor chat, and the outward API-key facade.
- **Real dep:** A connected real calendar account (see [[calendar-connect]]), a real model for the chat path, and an outward key for the facade path. Also a role granting the booking tool, or the tools never assemble — see [[booking-slots]].
- **Backing e2e:** `chat-book-success` · `chat-book-conflict-*` · `chat-book-quota-exhausted` · `tool-calendar-cancel-booking` · `connector-calendar-cancel-tool` · `visitor-cancel-booking` · `tool-endpoint-calendar-book`.

## Checks

### 1 — A booking appears on the real calendar ⭐
- **Steps:** Book through chat. Open the account's calendar in its own web view. Find the event.
- **Expected:** The event exists there, with the right title, time and attendees. Reading the tool's own success reply is not this check — the calendar is.
- **Backing test:** `chat-book-success.spec.ts`

### 2 — Cancelling removes that event
- **Steps:** Cancel the booking through chat. Open the calendar again.
- **Expected:** The event is gone.
- **Backing test:** `tool-calendar-cancel-booking.spec.ts` · `visitor-cancel-booking.spec.ts`

### 3 — Rescheduling moves the event, and does not clone it
- **Steps:** Reschedule the booking. Open the calendar.
- **Expected:** The same event now sits at the new time. There is no second event at the old one.
- **Backing test:** `gap`

### 4 — The booking quota counts real events
- **Steps:** Book up to a code's quota, letting real events accumulate. Attempt one more.
- **Expected:** The over-limit attempt is refused in readable words, and no extra event lands.
- **Backing test:** `chat-book-quota-exhausted.spec.ts`

### 5 — A duplicate insert is handled, not assumed away ⭐
- **Steps:** Provoke the same event being inserted twice, for instance through a reconnect and retry. Read what the provider returned and what the backend did with it.
- **Expected:** The provider's conflict response is handled and the visitor is not double-booked.
- **Mock gap:** The mock answers a duplicate insert with an idempotent success. So the "no double booking after a reconnect" that CI proves rests on a behaviour a real provider does not have, and the real conflict path has never run.
- **Backing test:** `connector-retry-*.spec.ts` · the real conflict → `gap`

### 6 — The model reasons its way to a booking
- **Steps:** Ask to book in plain language, with no scripted tool queue. Watch the model list slots and then book.
- **Expected:** It selects a sane slot and books it. It does not invent a confirmation without calling the tool.
- **Backing test:** `tool-endpoint-calendar-book.spec.ts`

### 7 — The API path books against the same real calendar
- **Steps:** Open a booking capability on an outward key. Dispatch a booking through the facade. Check the real calendar. Then try to exceed the policy and the quota through the same path.
- **Expected:** The event lands on the real calendar, and policy and quota are enforced exactly as they are in chat.
- **Mock gap:** The facade suite only dispatches a corpus tool. There is no booking-through-a-key case at all.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

A confirmed booking renders a friendly confirmation, never a raw tool result.
A refusal for a conflict or a quota reads as a sentence, not as an error code.
Verify the outcome where it lives — a chat bubble saying "booked" is a claim, and the calendar is the fact.
