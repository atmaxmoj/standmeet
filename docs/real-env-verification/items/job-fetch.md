# job-fetch — Jobs: real board fetch, schema, pagination, dedup

- **Module:** `jobs.fetch_new` pulls real postings from each public job board, maps each source's own schema correctly, consumes every page, collapses the same posting reached through two sources, and lands the result in the 1-day pool.
- **Surface:** `/admin/sources` to register, and owner MCP (`jobs.fetch_new`) to pull. Results land in `/admin/listings`.
- **Real dep:** The real public job APIs. Most need only a public company slug. One source requires an employer token that is not held, so it stays out of reach.
- **Backing e2e:** `job-fetch-multi-source` · `job-fetch-deduplicates` · `job-fetch-cross-source-dedup` · `job-sources-register` · `job-fetch-ttl-eviction` · `job-fetch-workday-bamboohr` · `job-fetch-workable` · `job-fetch-jba`.

## Checks

### 1 — Each source's postings arrive mapped correctly ⭐
- **Steps:** Register one real source of each kind, using a public slug. Fetch with no source filter. Read the pooled rows: title, company, location, url, tags and published date, each tagged with the source it came from.
- **Expected:** Real postings surface with every field mapped from that source's own schema. A field the source provides is not empty in the pool.
- **Mock gap:** Three source kinds have fixtures. The rest — including the aggregator boards and the forum-style source — have no coverage at all, so their real schema mapping has never run.
- **Backing test:** `job-fetch-multi-source.spec.ts` · `job-sources-register.spec.ts`

### 2 — The same posting from two sources becomes one row
- **Steps:** Register two sources that both carry one company's postings. Fetch. Look for a posting whose URL appears in both.
- **Expected:** One row, not two. The pool dedups by URL across sources.
- **Backing test:** `job-fetch-deduplicates.spec.ts` · `job-fetch-cross-source-dedup.spec.ts`

### 3 — Every page is consumed, not just the first ⭐
- **Steps:** Pick a company with more than a hundred postings. Fetch. Count the pooled rows against what the board's own site shows.
- **Expected:** The full set arrives. Each source's paging style is followed to the end — offsets, cursors, and link headers alike.
- **Mock gap:** No fixture paginates. Every one returns a single short page, so the paging code has never been exercised against more than one page.
- **Backing test:** `gap`

### 4 — A source needing an unavailable token fails loudly
- **Steps:** Register the token-requiring source with a wrong token. Fetch. Read what comes back.
- **Expected:** A real upstream authentication error reaches the owner. An empty result presented as success is the failure — it reads as "no jobs today".
- **Backing test:** `job-fetch-workable.spec.ts` (needs a token to run)

### 5 — A source that fetches per item survives dead entries
- **Steps:** Fetch the forum-style source, which requests one item per posting. Let it run against the live feed, which contains deleted and dead entries.
- **Expected:** Live items parse. Deleted, dead and null items are skipped without crashing. The latency of many small requests degrades gracefully rather than hanging the fetch.
- **Mock gap:** This source has no spec at all. The per-item fan-out, its latency, and the skip path are all untested.
- **Backing test:** `gap`

### 6 — A source with an adapter but no route says so
- **Steps:** Register a source whose adapter exists. Fetch.
- **Expected:** Either postings arrive, or the failure names the missing piece. A configured source that quietly 404s looks identical to a company with no openings.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The sources list populates after registering, and each row says when it last fetched.
Fetched jobs render as readable postings, not empty rows and not raw payload.
Every affordance on the page does something — sources are registered through MCP by design, so the page must not offer buttons that contradict that.
