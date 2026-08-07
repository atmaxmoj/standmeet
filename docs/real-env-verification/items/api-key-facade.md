# api-key-facade — Outward API-key facade: rate-limit + no-leak

- **Module:** The outward API-key facade rate-limits per key against real Redis, isolates one key's usage from another's, and never exposes the owner surface. An outward key cannot reach admin or the owner MCP, owner tools never appear in its discovery, and a bad key only ever gets a 401.
- **Surface:** The outward API (`api.open` / `QUERY` / `POST`). No GUI, except the admin api-keys list that mints and revokes.
- **Real dep:** The prod stack with real Redis, and a small real corpus. Corpus dispatch itself → [[corpus-search]]. Booking through a key → [[booking-book]].
- **Backing e2e:** `api-key-facade` · `api-key-security` · `public-rate-limit` · `retrieval-acl` · `visitor-chat-permissions-deny`.

## Checks

### 1 — One key over its cap trips a real 429 ⭐
- **Steps:** Drive one key past its per-key window cap against real Redis. Read the response.
- **Expected:** The over-limit call returns 429 with a sentence the caller can act on, never a stack trace.
- **Backing test:** `api-key-security.spec.ts` · `public-rate-limit.spec.ts`

### 2 — A second key is unaffected by the first key's usage
- **Steps:** While the first key is over its cap, drive a second key inside its own cap.
- **Expected:** The second key succeeds. The limiter buckets per key, not globally.
- **Note:** The failure this guards against is memory pressure silently dropping limiter buckets and letting a key over-run (see [[resilience]]).
- **Backing test:** `api-key-security.spec.ts`

### 3 — An oversized body is bounded, not hung
- **Steps:** POST a body far past the limit.
- **Expected:** The call returns 413. It does not hang and it does not consume the process.
- **Backing test:** `api-key-security.spec.ts`

### 4 — An outward key cannot reach the owner surface ⭐
- **Steps:** With a valid outward key, call `/api/admin/*`. Call `/mcp`. Read the key's own tool discovery.
- **Expected:** Both calls are refused. No owner-only tool appears anywhere in the key's discovery.
- **Backing test:** `api-key-security.spec.ts` · `api-key-facade.spec.ts`

### 5 — Every bad key shape yields exactly 401
- **Steps:** Call with an unknown key, a revoked key, and a malformed key.
- **Expected:** All three return 401. None distinguishes itself from the others in a way that helps a guesser.
- **Backing test:** `api-key-facade.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The admin api-keys list renders, and create and revoke both fire.
Keys are masked on screen after minting, so the list is not a place to harvest one.
A revoked key disappears from the list, or is visibly marked, rather than looking live.
