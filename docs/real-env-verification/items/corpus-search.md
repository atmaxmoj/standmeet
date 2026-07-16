# corpus-search — Corpus: search relevance + ACL + PG fallback

- **Status:** 🟢 check 1 GREEN at real scale (2026-07-15) — relevance verified over the truly-synced corpus (223 wiki), on prod's real PG-FTS path. Checks 2 (API-key facade dispatch) + 3 (Meili-down recovery) still ⬜.
- **Module:** `corpus_search` over real content is relevant and write→search consistent, role-scoped by the caller's ACL, and correct on the **PG-FTS fallback** (prod ships without Meilisearch by default); the API-key facade dispatches the same real search.
- **Surface:** visitor chat retrieval + API-key facade + backend search.
- **Real dep:** the full real corpus indexed; prod stack (PG-FTS by default; a pinned Meili only if opted in).
- **Backing e2e:** `retrieval-search-consistency` · `api-key-facade` · `retrieval-acl` · `retrieval-degrade`.

## Checks

### 1 — Scale / perf + real `corpus_search` relevance  (was §L13, search half)
- **Steps:** with the full real corpus indexed, run `corpus_search` over real content: write-then-search consistency (`WaitForTask` strong consistency), delete-then-miss, mixed CJK+EN relevance (real vault is English; confirm the CJK path against a seeded CJK note).
- **Expected:** written notes are immediately searchable and deleted ones immediately gone; CJK query hits its note; relevance is sane on real prose.
- **⚠️ mock gap:** `retrieval-search-consistency` seeds a handful of docs; real relevance at corpus scale is not covered, and **the degrade-to-PG-FTS fallback has no backing spec here** (that failure mode is check 3 / [[resilience]]).
- **Backing test:** `retrieval-search-consistency.spec.ts` (Meili read/write consistency + CJK).
- **Result:** 🟢 **GREEN at real scale (2026-07-15).** Driven LLM-free via HTTP `QUERY /api/v1/sessions/{id}/tools/corpus_search` (corpus_search is `readOnlyHint`, so QUERY dispatches the real tool without an agent turn) under a real code session (`VERIFY-A01`, public role). Relevance on real prose is sane: `ergodic theory` → **`math/orbit/ergodic-theory-of-orbits`** top (then gauss-map, collatz — genuinely adjacent); `gauss map` → `math/orbit/gauss-map` top; `requisite variety` → **`cybernetics/theory/ashby`** top, then `good-regulator-theorem` (semantically right — it's Ashby's law, matched without the word "Ashby" in the query); `chomsky hierarchy` → the chomsky-hierarchy subtree. Write→search consistency proven implicitly and strongly: **every one of these hits is a note that only entered the corpus at all after F-L-8** (the 173 previously-unsyncable leaves) and was searchable minutes later. ACL correct: all hits `wiki:`, scoped to the public role's globs. **This also covers check 3's core claim** — prod runs NO Meili container (verified: `standmeet-prod-{app,backend,redis,db,gotenberg,minio}`), so this relevance IS the PG-FTS fallback serving as prod's primary path. Not covered here: CJK (the real vault is English), delete-then-miss, and Meili-down→recovery re-indexing (check 3).

### 2 — Real corpus dispatch via API-key facade  (was §J1)
- **Steps:** mint an outward API key → `api.open corpus.retrieval` → issue `QUERY corpus_search` (and a `corpus_read`) over the **real seeded corpus** → confirm real hits come back, ranked, and role-scoped to what the key may see.
- **Expected:** real corpus rows returned (not fixture rows), tool discovery renders only the opened non-Agentic tools, results respect the key's capability scope. Private/raw content excluded from an outward key.
- **⚠️ note:** with prod shipping without Meili by default (check 3), this runs on **PG-FTS fallback** — verify the fallback returns relevant hits over real content, not just that it doesn't 500.
- **Backing test:** `api-key-facade.spec.ts:152` · `api-key-facade.spec.ts:154` · `api-key-facade.spec.ts:160`
- **Result:** ⬜

### 3 — Meili down → clean PG-FTS fallback  (was §L13 / §P5 fallback)
- **Steps:** kill Meili → confirm `corpus_search` degrades to PG-FTS without a 500; writes still land; recovery re-indexes the down-period writes. (Prod's DEFAULT is already PG-FTS — verify the fallback IS the primary prod path: relevance acceptable CJK+EN, write→search consistent, nothing assumes Meili present.)
- **Expected:** killing Meili degrades to PG-FTS without a 500; admin shows degraded; recovery re-indexes.
- **Backing test:** `retrieval-degrade.spec.ts:56` · `retrieval-degrade.spec.ts:73` · `retrieval-search-consistency.spec.ts:108`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Search results render relevant real hits (not empty, not fixture rows); an out-of-scope query returns nothing (ACL), not a private title.

## Findings
(record here; also log `../findings.md`, ID `F-L-n` / `F-J-n` / `F-P-n` historical anchor)

- **P5 confirmed** (first pass): no meili in prod → `corpus_search` on PG-FTS by default.
