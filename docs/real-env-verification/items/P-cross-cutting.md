# §P — Cross-cutting live-only failure modes

- **Status:** ⬜ not-run
- **Scope:** `P4/P5/P6 runnable-now` · `P1/P2/P3 partial`
- **Prereqs/creds:** P4/P5/P6 need only the prod stack (`make prod-up`). **P1** needs a real integration that returns `429 Retry-After` (a real rate-limited provider, or a fronting proxy that injects it). **P2** needs a **real OAuth provider** (§B Google) — cannot be reproduced at the mock layer, hence `partial`. **P3** needs a DB of real encrypted connector creds + an `INSTANCE_SECRET` rotation.
- **Real service:** live-only failure modes that **no mock exercises** — real `Retry-After`, real OAuth `invalid_grant`, real envelope-decrypt after secret rotation, real Redis eviction under memory pressure, real Meili at scale + PG fallback, real `/v1/models` discovery.
- **Backing e2e:** (attribution targets) `connector-retry-*` (`connector-retry-exhausted-degrades`, `connector-retry-insert-idempotent`, `connector-retry-invalid-grant-no-retry`, `connector-retry-read-transient-recovers`, `connector-retry-send-idempotent`) · `connector-err-refresh-network` · `job-fetch-ttl-eviction` · `session-token-eviction` · `retrieval-degrade` · `retrieval-search-consistency` · `inference-usage` · `security-inference-models-ssrf`

## Sub-items

### P1 — `Retry-After` ignored ⭐
- **Steps:** front a real integration (or a proxy) that returns `429 Retry-After: 30` → drive a call that trips it → observe the retry timing.
- **Expected:** the client **waits `Retry-After` seconds** before retrying.
- **⚠️ mock gap / likely RED:** `backend/internal/httpx/retry_transport.go:78` (`retriableStatus`) retries `429`/`5xx` on a **fixed backoff** and **never reads `Retry-After`** — on a real rate-limited provider it retries too early and can *worsen* a ban. **No mock ever sends `429`/`Retry-After`** (inventory §A: mock only emits a 500, never 429/529), so CI's green "retry" proof is against a header that never exists. **High-value Finding candidate** — the fix must land as a test that reproduces a `Retry-After` response and asserts the wait, then honor the header.
- **Backing test:** `connector-retry-exhausted-degrades.spec.ts` + `connector-retry-read-transient-recovers.spec.ts` (retry behavior — but neither drives a `Retry-After` header; that's the incompleteness). Pairs with §A16 (real 429/529 backoff).
- **Result:** ⬜

### P2 — OAuth silent refresh + `invalid_grant`  (partial)
- **Steps:** on a **real** OAuth provider (§B Google, §H2) force token expiry/skew → next call should refresh transparently; revoke the grant → the refresh should return `invalid_grant` and surface as a friendly "reconnect required".
- **Expected:** transparent refresh on expiry; `invalid_grant` → friendly reconnect prompt, no crash, no retry storm (an `invalid_grant` must **not** be retried).
- **⚠️ partial:** needs a real provider — the mock **validates no client_secret/code/PKCE/redirect_uri and never rotates the refresh token** (`gcal.go:172`, inventory §H2/B7), so the persist-new-refresh-token and real `invalid_grant` paths can't be reproduced without live Google. Mark `partial`; the reproducible half (no-retry-on-invalid_grant) can be tested, the real-provider half stays `manual-only`.
- **Backing test:** `connector-retry-invalid-grant-no-retry.spec.ts` (no retry on invalid_grant) · `connector-err-refresh-network.spec.ts` (refresh transient) · `connector-gcal-rotate-creds-reverify.spec.ts`
- **Result:** ⬜

### P3 — Envelope decrypt + `INSTANCE_SECRET` rotation  (partial)
- **Steps:** with a DB holding real encrypted connector creds, rotate `INSTANCE_SECRET` → attempt to use a connector → observe.
- **Expected:** a friendly "reconnect required" (AAD mismatch handled), **not** a decrypt panic.
- **⚠️ partial:** needs a populated encrypted-creds DB + a rotation event — not driven by any current spec (gap). Reproducible in a test harness (encrypt under key A, boot under key B, assert friendly error), so this can become RED→GREEN, but it needs new coverage.
- **Backing test:** no dedicated spec (gap); `connector-secret-no-leak.spec.ts` is the nearest cred-at-rest coverage.
- **Result:** ⬜

### P4 — Redis TTL eviction under memory pressure
- **Steps:** run a memory-capped Redis with a `maxmemory-policy` → fill the 1d job pool until eviction → confirm graceful behavior; bounce Redis → confirm sessions/rate-limit recover.
- **Expected:** eviction is graceful (a `jobs.show` on an evicted/expired `cache_id` errors friendly, not 500); after a Redis bounce, sessions and rate-limit buckets recover.
- **Backing test:** `job-fetch-ttl-eviction.spec.ts:33` (cache_id resolvable post-fetch; expired → `jobs.show` errors) · `session-token-eviction.spec.ts:41` (evict vsession → next turn 401)
- **Result:** ⬜

### P5 — Meili version drift + `WaitForTask` latency at scale
- **Steps:** index a few-thousand-doc corpus on a **pinned prod Meili** → check write-then-search consistency + latency → then **kill Meili** and confirm a clean **PG fallback**.
- **Expected:** write-then-search is consistent at scale; killing Meili degrades to PG-FTS without a 500; recovery re-indexes the down-period writes.
- **⚠️ prod-default note:** **prod ships WITHOUT meilisearch** (inventory §1: meili is a dev/permissive real instance, not in the prod default) — so `corpus_search` runs on the **PG-FTS fallback by DEFAULT** in prod. Verify the *fallback* is the primary prod path: relevance is acceptable (CJK+EN), write→search is consistent, and nothing assumes Meili is present. The "Meili at scale" half only applies if an owner opts Meili in.
- **Backing test:** `retrieval-degrade.spec.ts:56` (Meili down: search degrades, no 500, writes land, admin shows degraded) · `retrieval-degrade.spec.ts:73` (recovery → re-index) · `retrieval-search-consistency.spec.ts:108` (promote → immediately searchable)
- **Result:** ⬜

### P6 — Inference `/v1/models` discovery
- **Steps:** with a real inference key, hit the admin/BYOAI model picker → it calls `/v1/models` (a **different** endpoint than chat, `inference_models.go:147`) → verify a key that can chat but can't list models, a 429, and a sanitized error.
- **Expected:** the picker lists real models when the key is scoped for it; a chat-only key gives a friendly "can't list" (not a leak of the raw upstream body); 429 handled; SSRF-guarded (no internal dial).
- **Backing test:** `security-inference-models-ssrf.spec.ts:24` (POST /inference/models → refused, no internal dial) · `inference-usage.spec.ts:57` (token usage recorded → admin summary)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-P-n`)
