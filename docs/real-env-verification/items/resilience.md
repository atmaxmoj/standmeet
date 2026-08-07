# resilience — Live-only resilience: eviction, search drift, models discovery

- **Module:** The failure modes no mock exercises. Redis evicting under memory pressure, a search engine drifting or lagging at scale, and inference model discovery — a different endpoint from chat. Each degrades to a sentence the owner can act on, with no 500 and no leak of an upstream body.
- **Surface:** The backend, and the model picker used for BYOAI.
- **Real dep:** A memory-capped Redis. A real inference key. Optionally a pinned search engine at scale — prod's default is the Postgres path, see [[corpus-search]].
- **Backing e2e:** `job-fetch-ttl-eviction` · `session-token-eviction` · `retrieval-degrade` · `retrieval-search-consistency` · `inference-usage` · `security-inference-models-ssrf`.

## Checks

### 1 — Eviction is graceful, and a restart recovers
- **Steps:** Run Redis with a memory cap and an eviction policy. Fill the job pool until eviction happens. Ask for an evicted entry by id. Then restart Redis and use an existing session and a rate-limited key.
- **Expected:** The evicted lookup returns a friendly error, not a 500. After the restart, sessions and rate-limit buckets recover rather than wedging.
- **Backing test:** `job-fetch-ttl-eviction.spec.ts` · `session-token-eviction.spec.ts`

### 2 — Search stays consistent at scale, and its loss degrades
- **Steps:** Index a few thousand documents on a pinned engine. Write, then search immediately. Measure how long a search takes. Stop the engine and search again.
- **Expected:** Write-then-search is consistent at scale and the latency stays usable. Stopping the engine falls back to Postgres full text without a 500, and recovery re-indexes.
- **Note:** Prod ships without the engine, so the fallback is the normal path, not the emergency one.
- **Backing test:** `retrieval-degrade.spec.ts` · `retrieval-search-consistency.spec.ts`

### 3 — Model discovery handles a key that cannot list ⭐
- **Steps:** Open the model picker with a real key. Then use a key that can chat but cannot list models. Then drive it into a rate limit. Then point it at an internal address.
- **Expected:** A scoped key lists real models. A chat-only key gets a sentence saying it cannot list, with no raw upstream body echoed back. A rate limit is handled. An internal address is refused.
- **Backing test:** `security-inference-models-ssrf.spec.ts` · `inference-usage.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The model picker lists models rather than sitting empty or showing an error.
Every degraded path reaches the owner as a sentence, never as a 500 page and never as a raw upstream payload.
A recovered dependency leaves no wedged state behind — check the surface again after the restart, not only during the outage.
