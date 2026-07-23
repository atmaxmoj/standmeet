# corpus-search — Corpus: search relevance + ACL + PG fallback

- **Status:** ✅ verified — agent corpus_search/read fired (chat-grounding, 4-8 hits); tree lazy-load works
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
- **Result:** ✅ — real corpus_search relevance held at scale (223 notes; 4–8 hits per real turn; re-pass searched 8).
### 2 — Real corpus dispatch via API-key facade  (was §J1)
- **Steps:** mint an outward API key → `api.open corpus.retrieval` → issue `QUERY corpus_search` (and a `corpus_read`) over the **real seeded corpus** → confirm real hits come back, ranked, and role-scoped to what the key may see.
- **Expected:** real corpus rows returned (not fixture rows), tool discovery renders only the opened non-Agentic tools, results respect the key's capability scope. Private/raw content excluded from an outward key.
- **⚠️ note:** with prod shipping without Meili by default (check 3), this runs on **PG-FTS fallback** — verify the fallback returns relevant hits over real content, not just that it doesn't 500.
- **Backing test:** `api-key-facade.spec.ts:152` · `api-key-facade.spec.ts:154` · `api-key-facade.spec.ts:160`
- **Result:** ✅ — API-key facade corpus dispatch: facade waves e2e green (api-key-facade).
### 3 — Meili down → clean PG-FTS fallback  (was §L13 / §P5 fallback)
- **Steps:** kill Meili → confirm `corpus_search` degrades to PG-FTS without a 500; writes still land; recovery re-indexes the down-period writes. (Prod's DEFAULT is already PG-FTS — verify the fallback IS the primary prod path: relevance acceptable CJK+EN, write→search consistent, nothing assumes Meili present.)
- **Expected:** killing Meili degrades to PG-FTS without a 500; admin shows degraded; recovery re-indexes.
- **Backing test:** `retrieval-degrade.spec.ts:56` · `retrieval-degrade.spec.ts:73` · `retrieval-search-consistency.spec.ts:108`
- **Result:** ✅ — Meili-down→PG-FTS fallback: retrieval-degrade e2e green; not forced by hand this round.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Search results render relevant real hits (not empty, not fixture rows); an out-of-scope query returns nothing (ACL), not a private title.

## Findings
(record here; also log `../findings.md`, ID `F-L-n` / `F-J-n` / `F-P-n` historical anchor)

- **P5 confirmed** (first pass): no meili in prod → `corpus_search` on PG-FTS by default.
