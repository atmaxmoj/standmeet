# Q4 — Email-bomb hardening: per-recipient send throttle

Status: **design 2026-09-06.** Owner earlier: "我们的 email 那边有没有防范 email bomb,安全不可小觑,排队。"

## Findings (what's already OK — don't rebuild)
- The only truly public entry, `POST /api/v1/access-requests`, already has a **per-IP flood guard**
  (`RequestGuard.Locked/RecordSubmit`, captcha-lift) and **only writes a queue — it sends no mail**
  ("volume is the signal"). Not a direct bomb vector.
- Actual outbound mail is gated: (a) `access_requests.approve` is an **owner op** (manual approval
  issues the code + mail to the requester) — not public, not batch; (b) booking confirmation is a
  **synchronous single send**, code-gated + bounded by per-code `max_bookings`; (c) owner-notify goes
  through `RetryingMailProxy` (≤10 tries / 2 min, to the owner's own address).
- **Residual gap:** there is **no per-RECIPIENT throttle** (only per-IP). Each path is already
  bounded, so risk is LOW — this is defense-in-depth, not a hole-plug.

## Implementation plan (defense-in-depth, low priority)
1. **Per-recipient send gate** at the one outbound convergence point (the mailer/connector send path,
   `internal/connector`): before a send, check a Redis counter keyed `mail:rcpt:<sha256(email)>` (hash
   the address — never store raw PII as a key, and never in a URL) with a rolling window (e.g. ≤N
   sends / hour / recipient). Over → skip + log (do not error the user flow); a booking still
   succeeds, the *email* is rate-limited.
2. **Keep it a single seam:** all three senders (approval, booking confirm, owner-notify) route
   through this gate, so no path can bypass it ([[dispatcher-outbound-convergence]]).
3. Owner-notify to the owner's own address gets a **separate, higher** budget (it's not a victim).
4. Confirm (test) that approval stays owner-manual (no auto/batch approval endpoint).

## Test plan (test-first, RED-reachable)
### Unit
- **U1 throttle logic:** N sends to recipient R within the window pass; the N+1th is throttled; a
  different recipient R2 is unaffected; the window resets after T. Pure logic over a fake clock/store.
- **U2 key is hashed:** the Redis key derives from a hash of the address, not the raw email (assert no
  raw address in the key) — PII discipline.
- **U3 owner-notify budget:** the owner's own address uses the higher budget, not the visitor budget.
### Integration
- **I1 booking still succeeds while mail is throttled:** past the recipient budget, `booking.commit`
  returns success but the confirmation send is skipped + logged (assert the row exists, the send count
  did not increase). Proves throttling doesn't break the user action.
- **I2 approval is owner-gated:** there is no public/code path that triggers approval mail; only the
  owner op does (assert the route surface).
### RED-reachability
- Removing the recipient gate lets the N+1th send through → U1/I1 go RED.

## Open decision
Window + budget numbers (N/hour/recipient). Recommend conservative (e.g. 5/hour/recipient for
visitor-facing mail, higher for owner-notify), configurable via env, defaulting safe.
