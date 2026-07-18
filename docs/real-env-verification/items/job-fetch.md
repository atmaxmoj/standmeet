# job-fetch — Jobs: real board fetch, schema, pagination, dedup

- **Status:** ⬜ not started (new round)
- **Module:** `jobs.fetch_new` pulls real postings from each public board with the correct per-source schema mapping, paginates fully, dedups same-URL cross-source collisions, and lands in the 1d Redis pool.
- **Surface:** admin/sources (register) + owner MCP (`jobs.fetch_new`).
- **Real dep:** real public job APIs — Greenhouse / Lever / Ashby / RemoteOK / WWR / HN Firebase / BambooHR / Workday (public company slug, no token). Workable needs an employer SPI token we don't hold (⛔).
- **Inherits (historical finding IDs):** `F-E-1` (dead +board/+rss buttons removed — ✅ fixed; sources are MCP-registered by design).
- **Backing e2e:** `job-fetch-multi-source` · `job-fetch-deduplicates` · `job-fetch-cross-source-dedup` · `job-sources-register` · `job-fetch-ttl-eviction` · `job-fetch-workday-bamboohr` · `job-fetch-workable` · `job-fetch-jba`.

## Checks

### 1 — `jobs.fetch_new` per source (schema → 1d Redis pool)  (was §E1)
- **Steps:** register a real Greenhouse / Lever / Ashby / RemoteOK / WWR / HN source (public slug only) → `jobs.fetch_new` with no `source_id` → union lands in the 1d Redis pool, each row tagged with its `source_kind`, deduped by URL.
- **Expected:** real postings surface with correct per-source schema mapping (title / company / location / url / tags / published_at); same-URL cross-source collisions collapse to one row.
- **⚠️ mock gap:** Greenhouse / Lever / Ashby are covered by fixtures, but **RemoteOK / WeWorkRemotely / HN have no e2e at all** — their real schema mapping has never been exercised.
- **Backing test:** `job-fetch-multi-source.spec.ts` · `job-fetch-deduplicates.spec.ts` · `job-fetch-cross-source-dedup.spec.ts` · `job-sources-register.spec.ts`
- **Result:** ⬜
### 2 — SmartRecruiters (no mock + no route → 404s today)  (was §E2)
- **Steps:** register a real public SmartRecruiters company → `jobs.fetch_new`. Real SR is a two-call N+1 (list postings → per-posting detail).
- **Expected:** real SR postings surface.
- **⚠️ mock gap:** `SMARTRECRUITERS_BASE_URL` is set and the adapter + fixture exist, but `job-board/main.go` serves **no route** → it **404s today**. The real two-call N+1 has never been driven.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜
### 3 — Pagination across all sources  (was §E3)
- **Steps:** pick a company with **>100 postings** → `jobs.fetch_new` must consume **all pages** (Greenhouse / Lever / Ashby offset · Workday POST-cursor · Workable `Link` header · SmartRecruiters offset).
- **Expected:** the full set surfaces, not just page 1.
- **⚠️ mock gap:** **no mock paginates** — every fixture returns a single short page.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜
### 4 — Tokened/auth sources — BambooHR + Workday slug only · Workable ⛔  (was §E4)
- **Steps:** BambooHR — register `{company:<slug>}` no token → public `https://{slug}.bamboohr.com/careers/list`. Workday — register `{company:<slug>}` → public CXS POST-cursor. Workable — SPI `{base}/spi/v3/accounts/{company}/jobs` is **authed** (`parseWorkableConfig` requires `company`+`api_token`).
- **Expected:** BambooHR + Workday real public jobs surface **from the slug alone, no token**; a wrong Workable token surfaces a **real upstream auth error, not silent empty**.
- **⚠️ nuance:** **BambooHR & Workday need only a public slug — NO token.** **ONLY Workable requires an employer SPI token** we don't hold → E4-Workable **⛔ blocked / skip**.
- **Backing test:** `job-fetch-workday-bamboohr.spec.ts` · `job-fetch-workable.spec.ts` (⛔ not runnable without a token)
- **Result:** ⬜
### 5 — HN real N+1 + null/dead items  (was §E5)
- **Steps:** fetch HN Who-is-Hiring → real Firebase per-item N+1 (one request per comment id), real latency, `deleted`/`dead` items in the stream.
- **Expected:** live items parse; `deleted`/`dead`/null items are skipped without crashing; latency degrades gracefully.
- **⚠️ mock gap:** there is **no HN e2e**; the real Firebase per-item N+1, its latency, and the null/dead-item skip path are all untested.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
admin/sources **list populates** after registering; fetched jobs render (not empty/garbled); no dead +board/+rss buttons (F-E-1).

## Findings
(record here; also log `../findings.md`, ID `F-E-n` historical anchor)

- **E1 pass · F-E-1 ✅fixed** (removed dead +board/+rss buttons; sources are MCP-registered by design).
