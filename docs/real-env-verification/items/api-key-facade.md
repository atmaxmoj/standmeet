# api-key-facade — Outward API-key facade: rate-limit + no-leak

- **Status:** ✅ e2e-covered — facade specs green; not separately drivable on GUI this round
- **Module:** the outward API-key facade rate-limits per-key against real Redis with cross-key isolation, and never leaks the owner surface — an outward key can't reach `/api/admin/*` or `/mcp`, owner tools never appear in its discovery, bad keys only ever 401.
- **Surface:** outward API (`api.open` / `QUERY` / `POST`) — no GUI.
- **Real dep:** prod stack + real Redis + a small real corpus. (Corpus dispatch itself → [[corpus-search]] check 2; booking-via-key → [[booking-book]] check 7.)
- **Inherits (historical finding IDs):** `F-J-1` (was a tester error — the seeded public role makes minting work out-of-box; downgraded).
- **Backing e2e:** `api-key-facade` · `api-key-security` · `public-rate-limit` · `retrieval-acl` · `visitor-chat-permissions-deny`.

## Checks

### 1 — Real rate limit under load → 429 + per-key isolation  (was §J2)
- **Steps:** drive one key past its per-key window cap against **real Redis** → observe `429` → in parallel drive a *second* key and confirm it is **not** throttled by the first key's usage.
- **Expected:** the over-limit key trips a real `429` (friendly, no stack trace); a different key stays unaffected — the limiter buckets per-key, not globally. Oversized body bounded (`413`), not hung.
- **⚠️ note:** the real check is that eviction/memory-pressure (see [[resilience]]) doesn't silently drop the limiter buckets and let a key over-run.
- **Backing test:** `api-key-security.spec.ts:124` · `api-key-security.spec.ts:126` (413) · `public-rate-limit.spec.ts:24`
- **Result:** ✅ e2e-covered — facade rate-limit + per-key isolation specs green (waves A–F).
### 2 — No-leak vs `/api/admin/*` + `/mcp` (live)  (was §J4)
- **Steps:** with a valid *outward* key, attempt `/api/admin/*` and `/mcp` requests → confirm they are refused and no owner-only tool ever appears in the key's discovery. Also confirm brute-forced/fabricated/malformed keys only ever yield `401`.
- **Expected:** an outward key cannot reach admin or the owner MCP surface; owner tools never leak into the outward toolset; unknown/revoked/malformed keys → `401`.
- **Backing test:** `api-key-security.spec.ts:128` · `api-key-security.spec.ts:122` · `api-key-facade.spec.ts:156` · `api-key-facade.spec.ts:158` (candidacy gate) · `api-key-facade.spec.ts:162` (revoked → 401)
- **Result:** ✅ e2e-covered — no-leak vs /api/admin/* + /mcp asserted (facade-directions).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The admin api-keys **list renders** with create/revoke that fire; keys are **masked** on screen.

## Findings
(record here; also log `../findings.md`, ID `F-J-n` historical anchor)

- **PASS (F-J-1 was inaccurate):** real Sigv1 owner-MCP `api_keys.create` with the seeded public role id → 200, minted `smk_…`. The public role is a persistent row (`SeedPublicRole` on claim), so minting works out-of-box; the first-pass "no default role" was a tester error. `corpus.retrieval` openable.
