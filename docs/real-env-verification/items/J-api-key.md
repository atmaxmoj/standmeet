# §J — API-key facade

- **Status:** ⬜ not-run
- **Scope:** `runnable-now`
- **Prereqs/creds:** none external. Needs the real prod stack (`make prod-up`), a claimed owner, and a small **real corpus** seeded (raw→wiki, one output). The facade is deterministic — this is mostly about running it against *real corpus content* and *real Redis rate-limiting* rather than a synthetic fixture.
- **Real service:** the outward **API-key facade** (`api.open` / `QUERY` / `POST`) dispatching over the **real corpus** + real retrieval backend + real per-key Redis rate limiter. No mock is replaced here on the LLM side (retrieval is deterministic search), but J3 booking pairs with **§B** (real Google Calendar).
- **Backing e2e:** (attribution targets) `api-key-facade` · `api-key-security` · `public-rate-limit` · `retrieval-acl` · `retrieval-search-consistency` · `visitor-chat-permissions-deny`

## Sub-items

### J1 — Real corpus dispatch (mint key → `api.open corpus.retrieval` → `QUERY corpus_search`)
- **Steps:** mint an outward API key → `api.open corpus.retrieval` on it → issue `QUERY corpus_search` (and a `corpus_read`) over the **real seeded corpus** → confirm real hits come back, ranked, and role-scoped to what the key may see.
- **Expected:** real corpus rows returned (not fixture rows), tool discovery renders only the opened non-Agentic tools, and results respect the key's capability scope. Private/raw content excluded from an outward key.
- **⚠️ note:** with prod shipping **without meilisearch by default** (see §P5), `corpus_search` here runs on the **PG-FTS fallback** — verify the fallback actually returns relevant hits over real content, not just that it doesn't 500.
- **Backing test:** `api-key-facade.spec.ts:152` (discovery renders opened non-Agentic tools only) · `api-key-facade.spec.ts:154` (QUERY + POST dispatch a corpus tool) · `api-key-facade.spec.ts:160` (per-key capability denial subtracts the tool)
- **Result:** ⬜

### J2 — Real rate limit under load → 429 + per-key isolation
- **Steps:** drive one key past its per-key window cap against **real Redis** → observe `429` → in parallel drive a *second* key and confirm it is **not** throttled by the first key's usage.
- **Expected:** the over-limit key trips a real `429` (friendly, no stack trace); a different key stays unaffected — the limiter buckets per-key, not globally. Also: oversized body bounded (`413`), not hung.
- **⚠️ note:** CI exercises this against a test Redis; the real check is that eviction/memory-pressure (§P4) doesn't silently drop the limiter buckets and let a key over-run.
- **Backing test:** `api-key-security.spec.ts:124` (per-key rate limit trips 429; other keys isolated) · `api-key-security.spec.ts:126` (oversized body → 413) · `public-rate-limit.spec.ts:24` (per-IP window cap 429)
- **Result:** ⬜

### J3 — Real booking via key (pairs §B)
- **Steps:** on a key with a booking capability opened, dispatch a booking tool through the facade → confirm the event actually lands in the connected **real** calendar (§B).
- **Expected:** the facade path can book against a real connector, honoring policy/quota exactly as the chat path does.
- **⚠️ mock gap:** `api-key-facade.spec.ts` only dispatches a **corpus** tool — there is **no booking-via-key case** in the facade suite (gap). Booking today is only proven through chat (`tool-endpoint-calendar-book`) and §B; verify the *facade* dispatch reaches the same real booking path.
- **Backing test:** no dedicated facade-booking spec (gap); nearest are `api-key-facade.spec.ts:154` (generic dispatch) + §B booking specs.
- **Result:** ⬜

### J4 — No-leak vs `/api/admin/*` + `/mcp` (live)
- **Steps:** with a valid *outward* key, attempt `/api/admin/*` and `/mcp` requests → confirm they are refused and that no owner-only tool ever appears in the key's discovery. Also confirm brute-forced/fabricated/malformed keys only ever yield `401`.
- **Expected:** an outward key cannot reach admin or the owner MCP surface; owner tools never leak into the outward toolset; unknown/revoked/malformed keys → `401`.
- **Backing test:** `api-key-security.spec.ts:128` (valid outward key cannot reach admin/mcp; no owner tool leaks) · `api-key-security.spec.ts:122` (brute-forcing fabricated keys → 401) · `api-key-facade.spec.ts:156` (missing/unknown/malformed → 401) · `api-key-facade.spec.ts:158` (candidacy gate: closed → 404, reopened → 200) · `api-key-facade.spec.ts:162` (revoked key → 401)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-J-n`)
