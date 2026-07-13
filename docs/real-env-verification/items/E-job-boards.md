# §E — Real job boards

- **Status:** ⬜ not-run
- **Scope:** public sources runnable · E4 Workable ⛔skip
- **Prereqs/creds:** none for the public sources — Greenhouse / Lever / Ashby / RemoteOK / WeWorkRemotely / HN Who-is-Hiring / BambooHR / Workday all fetch with **just a public company slug, no token**. `verify-creds.env` → `WORKABLE_COMPANY` + `WORKABLE_API_TOKEN` would be needed for E4-Workable, but that's an employer-side SPI token we don't hold → E4-Workable stays `⛔ blocked`.
- **Real service:** the real public job APIs — Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co`), Ashby (`api.ashbyhq.com`), RemoteOK, WeWorkRemotely, HN Firebase, BambooHR (`{slug}.bamboohr.com/careers/list`), Workday (public CXS cursor endpoint) — replacing `external-mock`'s 11 scripted job-board fixtures.
- **Backing e2e:** (attribution targets) `job-fetch-multi-source` · `job-fetch-deduplicates` · `job-fetch-cross-source-dedup` · `job-sources-register` · `job-fetch-ttl-eviction` · `job-fetch-workday-bamboohr` · `job-fetch-workable` · `job-fetch-jba` · `resume-draft-preview` · `resume-pdf-render` · `applications-commit` · `applications-commit-qr-works` · `integration-job-loop`

> One-time setup: on the prod stack claim owner → admin/sources register a public source per kind (Greenhouse `airbnb`, Lever `leverdemo`, Ashby slug, RemoteOK, WWR, HN, BambooHR slug, Workday slug) with **no `*_BASE_URL` overrides** so every fetcher hits the real upstream host. Then run `jobs.fetch_new` and inspect the 1d Redis pool.

## Sub-items

### E1 — `jobs.fetch_new` per source (schema → 1d Redis pool)
- **Steps:** register a real Greenhouse / Lever / Ashby / RemoteOK / WWR / HN source (public, company-slug only) → `jobs.fetch_new` with no `source_id` → union lands in the 1d Redis pool, each row tagged with its `source_kind`, deduped by URL.
- **Expected:** real postings surface with the correct per-source schema mapping (title / company / location / url / tags / published_at); same-URL cross-source collisions collapse to one row.
- **⚠️ mock gap:** the mock serves fixed synthetic fixtures; Greenhouse / Lever / Ashby are covered by fixtures, but **RemoteOK / WeWorkRemotely / HN have no e2e at all** — their real schema mapping has never been exercised.
- **Backing test:** `job-fetch-multi-source.spec.ts` · `job-fetch-deduplicates.spec.ts` · `job-fetch-cross-source-dedup.spec.ts` · `job-sources-register.spec.ts`
- **Result:** ⬜

### E2 — SmartRecruiters (no mock + no route → 404s today)
- **Steps:** register a real public SmartRecruiters company → `jobs.fetch_new`. Real SR is a two-call N+1 (list postings → per-posting detail).
- **Expected:** real SR postings surface.
- **⚠️ mock gap:** `SMARTRECRUITERS_BASE_URL` is set and the adapter (`smartrecruiters.go`) + a fixture exist, but `job-board/main.go` serves **no route** → it **404s today**. The real two-call N+1 has never been driven.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜

### E3 — Pagination across all sources
- **Steps:** pick a company with **>100 postings** → `jobs.fetch_new` must consume **all pages** (Greenhouse / Lever / Ashby offset · Workday POST-cursor · Workable `Link` header · SmartRecruiters offset).
- **Expected:** the full set surfaces, not just page 1.
- **⚠️ mock gap:** **no mock paginates** — every fixture returns a single short page, so the paging loop is never exercised against real cursor/offset/`Link` mechanics.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜

### E4 — Tokened/auth sources — BambooHR + Workday public slug only · Workable ⛔
- **Steps:**
  - **BambooHR** — register `{company: <slug>}` with **no token** → fetch hits the public `https://{slug}.bamboohr.com/careers/list`.
  - **Workday** — register `{company: <slug>}` → public CXS POST-cursor endpoint.
  - **Workable** — the SPI jobs endpoint `{base}/spi/v3/accounts/{company}/jobs` is **authed**: `parseWorkableConfig` requires **both `company` and `api_token`** (`workable.go:66-80`). The public v1 widget returns only account metadata, no jobs.
- **Expected:** BambooHR + Workday real public jobs surface **from the slug alone, no token** (`bamboohr.go` only needs `company`); a wrong Workable token should surface a **real upstream auth error, not silent empty**.
- **⚠️ nuance (state clearly):** **BambooHR & Workday need only a public company slug — NO token.** **ONLY Workable requires an employer SPI token**, which we don't hold, so E4-Workable is **⛔ blocked / skip** (the public widget returns no jobs and can't be verified).
- **Backing test:** `job-fetch-workday-bamboohr.spec.ts` (bamboohr + workday, public slug) · `job-fetch-workable.spec.ts` (register `{company, api_token}` / missing-token reject / wrong-token upstream error — ⛔ not runnable against real Workable without a token)
- **Result:** ⛔ (Workable) / ⬜ (BambooHR, Workday)

### E5 — HN real N+1 + null/dead items
- **Steps:** fetch HN Who-is-Hiring → real Firebase per-item N+1 (one request per comment id), real latency, `deleted`/`dead` items in the stream.
- **Expected:** live items parse; `deleted`/`dead`/null items are skipped without crashing; latency degrades gracefully.
- **⚠️ mock gap:** there is **no HN e2e**; the real Firebase per-item N+1, its latency, and the null/dead-item skip path are all untested.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜

### E6 — `resume.draft` + `applications.commit` with a real job snapshot
- **Steps:** pick a real fetched job (`cache_id`) → `resume.draft(cache_id, resume_content)` → preview the staging draft → `applications.commit(draft_id)` → real PDF (gotenberg) + AccessCode issued + QR printed top-right.
- **Expected:** real PDF renders (ATS-friendly, US-Letter); AccessCode issued (180d / 10 sessions / 50 turns); QR resolves to `/{handle}?code=…`; the job snapshot persists into the application row while the cache row stays 1d-TTL ephemeral.
- **Backing test:** `resume-draft-preview.spec.ts` · `resume-pdf-render.spec.ts` · `applications-commit.spec.ts` · `applications-commit-qr-works.spec.ts` · `integration-job-loop.spec.ts` · `job-fetch-ttl-eviction.spec.ts` (cache_id resolvable post-fetch)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-E-n`)
