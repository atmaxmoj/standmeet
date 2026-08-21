# booking-book — Booking: book / cancel / reschedule across dispatch paths

- **Module:** A booking lands on the real calendar. Cancelling deletes that event and rescheduling moves it rather than creating a second one. Quota is enforced against real accumulating events, and the same real path is reached whether the request comes from chat reasoning or from the outward API.
- **Surface:** Visitor chat, and the outward API-key facade.
- **Real dep:** A connected real calendar account (see [[calendar-connect]]), a real model for the chat path, and an outward key for the facade path. Also a role granting the booking tool, or the tools never assemble — see [[booking-slots]].
- **Backing e2e:** `chat-book-success` · `chat-book-conflict-*` · `chat-book-quota-exhausted` · `tool-calendar-cancel-booking` · `connector-calendar-cancel-tool` · `visitor-cancel-booking` · `tool-endpoint-calendar-book`.

## Checks

### 1 — A booking appears on the real calendar ⭐
- **Steps:** Book through chat. Open the account's calendar in its own web view. Find the event. Open the event itself and read its guest list.
- **Expected:** The event exists there, with the right title and time, and its guest list matches what the visitor supplied — the address they typed is on it, and the provider was asked to notify them. Reading the tool's own success reply is not this check — the calendar is. Drive the case where the visitor gives an address, not only the case where they skip it: an empty guest list is correct for a visitor who gave nothing, and it hides the whole invite path from view.
- **Backing test:** `chat-book-success.spec.ts`

### 1b — Whatever the chat promised about email actually happened ⭐
- **Steps:** Read what the confirmation said in words. If it names an address, **open that inbox** and search for the invite. Do this even when the calendar event looks correct.
- **Expected:** Every delivery the chat asserts has a message behind it. If nothing is sent, the chat must not say anything was. A booking whose confirmation says "the invite will go to <address>" and whose inbox stays empty is this check failing, not [[booking-email]]'s — that item covers the mail leg's own behaviour, this one covers the promise made at booking time. The check sits here, next to the action, because a driver who has to look it up in another item books, sees a friendly card, and moves on without ever opening a mailbox. Book as a guest with an address that is not the calendar account's own, since a provider does not email you an invitation to your own event — a plus-address on the same mailbox is a different guest to the provider and still lands where you can read it.
- **Backing test:** `booking-invite-truth.spec.ts` (the receipt names the invitee, or says there is none) · `chat-book-session-email-default.spec.ts` (the provider is asked to notify, not merely to list)

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

### 5 — Two callers cannot take the same slot ⭐
- **Steps:** Send two bookings for the identical slot at the same moment. Then open the calendar.
- **Expected:** One of them books; the other is told the time just went, in words it can act on. The calendar holds one event, not two. Concurrent bookings for *different* slots must both still succeed — a product that serialises the whole calendar has traded one defect for another.
- **Mock gap:** a real calendar has no "duplicate insert" error to lean on — Google's `events.insert` twice is simply two events. The protection has to come from this side, so the check is a race, not a provider response, and it is judged on the calendar rather than on the receipt.
- **Backing test:** `booking-slot-race.spec.ts` (asserts on the provider, not on the receipt) · `connector-retry-*.spec.ts`

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
