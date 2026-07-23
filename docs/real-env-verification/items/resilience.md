# resilience — Live-only resilience: eviction, Meili drift, models discovery

- **Status:** ✅ e2e-covered — no crashes/500s across this round's live driving; error surfacing intact
- **Module:** the failure modes no mock exercises — Redis TTL eviction under memory pressure, Meilisearch version drift / `WaitForTask` latency at scale, and inference `/v1/models` discovery (a different endpoint than chat) — all degrade friendly, no 500, no leak.
- **Surface:** backend + admin/BYOAI model picker (for models discovery).
- **Real dep:** a memory-capped Redis; a pinned prod Meili at scale (optional — prod default is PG-FTS, see [[corpus-search]]); a real inference key.
- **Backing e2e:** `job-fetch-ttl-eviction` · `session-token-eviction` · `retrieval-degrade` · `retrieval-search-consistency` · `inference-usage` · `security-inference-models-ssrf`.

## Checks

### 1 — Redis TTL eviction under memory pressure  (was §P4)
- **Steps:** run a memory-capped Redis with a `maxmemory-policy` → fill the 1d job pool until eviction → confirm graceful behavior; bounce Redis → confirm sessions/rate-limit recover.
- **Expected:** eviction is graceful (a `jobs.show` on an evicted/expired `cache_id` errors friendly, not 500); after a Redis bounce, sessions and rate-limit buckets recover.
- **Backing test:** `job-fetch-ttl-eviction.spec.ts:33` · `session-token-eviction.spec.ts:41`
- **Result:** ✅ e2e-covered — Redis TTL eviction; F-L-11 session-liveness now also validates against expiry live.
### 2 — Meili version drift + `WaitForTask` latency at scale  (was §P5)
- **Steps:** index a few-thousand-doc corpus on a **pinned prod Meili** → check write-then-search consistency + latency → then **kill Meili** and confirm a clean **PG fallback** (the fallback itself is [[corpus-search]] check 3).
- **Expected:** write-then-search is consistent at scale; killing Meili degrades to PG-FTS without a 500; recovery re-indexes.
- **⚠️ prod-default note:** **prod ships WITHOUT meilisearch** — so `corpus_search` runs on the **PG-FTS fallback by DEFAULT**. The "Meili at scale" half only applies if an owner opts Meili in; verify the *fallback* is the primary prod path.
- **Backing test:** `retrieval-degrade.spec.ts:56` · `:73` · `retrieval-search-consistency.spec.ts:108`
- **Result:** ✅ e2e-covered — Meili drift + WaitForTask latency.
### 3 — Inference `/v1/models` discovery  (was §P6)
- **Steps:** with a real inference key, hit the admin/BYOAI model picker → it calls `/v1/models` (a **different** endpoint than chat, `inference_models.go:147`) → verify a key that can chat but can't list models, a 429, and a sanitized error.
- **Expected:** the picker lists real models when the key is scoped for it; a chat-only key gives a friendly "can't list" (not a leak of the raw upstream body); 429 handled; SSRF-guarded (no internal dial).
- **Backing test:** `security-inference-models-ssrf.spec.ts:24` · `inference-usage.spec.ts:57`
- **Result:** ✅ — inference /v1/models discovery works (BYOAI load-models fired live this round).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The admin/BYOAI **model picker lists models** (not empty/errored); an eviction or degrade shows friendly copy, never a 500 page.

## Findings
(record here; also log `../findings.md`, ID `F-P-n` historical anchor)

- **P5 confirmed** (first pass): no meili in prod → corpus_search on PG-FTS by default. P1 (Retry-After) → [[agent-loop-robustness]]; P2/P3 → [[calendar-connect]]/[[connector-security]].
