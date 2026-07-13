# §B — Real Google Calendar

- **Status:** ⬜ not-run
- **Scope:** runnable-now
- **Prereqs/creds:** `verify-creds.env` → `GOOGLE_OAUTH_CLIENT_ID/SECRET` (project `nth-name-473413-v3`, Calendar API enabled, consent=External+Testing, test user=`sijie.wang.lark@gmail.com`). **Pending:** the OAuth redirect URI — after the Google connector exists, take the `redirect_uri` from its generated auth_url and add it back to the OAuth client.
- **Real service:** real `accounts.google.com` OAuth + `www.googleapis.com/calendar/v3`, replacing dev's `external-mock` `GOOGLE_*` overrides.
- **Backing e2e:** (attribution targets) `connector-happy-matrix` · `chat-book-success` · `chat-book-conflict-{busy,policy-hours,policy-leadtime,policy-weekend}` · `chat-book-quota-exhausted` · `chat-book-token-refresh` · `visitor-chat-list-slots` · `connector-calendar-cancel-tool` · `tool-calendar-cancel-booking` · `visitor-cancel-booking` · `connector-booker-handle-no-leak`

> One-time setup: on the prod stack, claim owner → admin builds a Google Calendar connector (paste client_id/secret, tick `calendar.readonly`+`calendar.events`) → get the connector id → back in Google, add redirect URI `…/connectors/{id}/callback` → run the connect. Only then can the sub-items run.

## Sub-items

### B1 — OAuth connect (real consent, real token)
- **Steps:** admin/connectors → connect Google → browser redirects to real Google consent → authorize → callback exchanges a real refresh/access token; connector flips to connected.
- **Expected:** connected; the DB stores real (encrypted) tokens, not mock tokens.
- **Backing test:** `connector-happy-matrix.spec.ts` (mock OAuth dance)
- **Result:** ⬜

### B2 — `list_slots` vs real freeBusy
- **Steps:** visitor chat asks for slots / call the booker directly with a real `timeMin/timeMax` window; compare against the account's real Google Calendar busy/free.
- **Expected:** only real free slots returned, and the **window is really filtered**.
- **⚠️ mock gap:** the mock ignores `timeMin/timeMax` (`gcal.go:390`) → window filtering never truly verified.
- **Backing test:** `visitor-chat-list-slots.spec.ts`
- **Result:** ⬜

### B3 — `calendar_book` → event actually appears in Google
- **Steps:** run one booking through chat → open the account's Google Calendar and confirm the event was created (title/time/attendees).
- **Expected:** the event appears in Google Calendar.
- **Backing test:** `chat-book-success.spec.ts`
- **Result:** ⬜

### B4 — cancel → event actually deleted
- **Steps:** cancel the booking → confirm the event is gone from Google Calendar.
- **Backing test:** `tool-calendar-cancel-booking.spec.ts` · `connector-calendar-cancel-tool.spec.ts` · `visitor-cancel-booking.spec.ts`
- **Result:** ⬜

### B5 — reschedule → event actually moved
- **Steps:** reschedule → confirm the time changed in Google Calendar (same event, not a new one).
- **Result:** ⬜

### B6 — send_confirmation actually sends the invite email
- **Steps:** book with confirmation → real `sendUpdates` makes Google send an invite; confirm receipt in §C's inbox.
- **Prereq:** pairs with §C.
- **Result:** ⬜

### B7 — token refresh + rotation
- **Steps:** force the access token to expire → the next call should refresh transparently; revoke it → should give a friendly `revoked` error.
- **⚠️ mock gap:** the mock never rotates the refresh token; the persist-new-refresh-token path is untested.
- **Backing test:** `chat-book-token-refresh.spec.ts`
- **Result:** ⬜

### B8 — `max_bookings` quota (real events)
- **Steps:** book up to the quota with real events accumulating; over-limit should be refused.
- **Backing test:** `chat-book-quota-exhausted.spec.ts`
- **Result:** ⬜

### B9 — duplicate-id insert → real Google returns 409 ⭐
- **Steps:** provoke a "same event id inserted twice" (e.g. the reconnect-retry path) → observe real Google's response.
- **Expected (likely RED):** real Google returns **409**, and the **backend has zero 409 handling**. CI's mock returns an idempotent 200 (`gcal.go:279`), masking it — the "no double-book after reconnect" CI proves would break live. **High-value Finding candidate.**
- **Backing test:** idempotency/retry specs (`connector-retry-*`) — focus here at attribution.
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-B-n`)
