# corpus-search — Corpus: search relevance + ACL + PG fallback

- **Module:** `corpus_search` over real content returns relevant hits, is consistent immediately after a write, and is scoped by the caller's ACL. The API-key facade dispatches the same real search.
- **By design** (`docs/design/open-work-multi-provider-gas-grep-i18n.md:267`) `corpus_search` **is the Meilisearch tool** — typo-tolerant, prefix, instant. `corpus_grep` is the second projection that catches what Meili's tokenizer misses: mid-word substrings, punctuation adjacency, **CJK bigrams** (same doc, :306). Postgres full text is the **degraded** path taken when `MEILI_URL` is empty (`boot_deps.go:142`), not the intended one.
- **Whether a given stack actually has the engine is an observation, never a premise of this file.** A deployment missing it is running degraded, and the checks below are what decide whether that is visible. Do not write the current state here — it belongs in the round's runsheet.
- **Surface:** Visitor chat retrieval, the outward API-key facade, and the backend search itself.
- **Real dep:** The full real corpus indexed on the prod stack. **No CJK note needs seeding** — the vault's `> [!i18n]` pane contract means real notes carry whole Chinese sections, so the CJK path has real input. (This line previously claimed the vault was English-only; it stopped being true when the i18n contract landed.)
- **Backing e2e:** `retrieval-search-consistency` · `api-key-facade` · `retrieval-acl` · `retrieval-degrade`.

## Checks

### 1 — A write is searchable at once, and a delete is gone at once
- **Steps:** Write a note with a distinctive term. Search for it immediately. Delete it. Search again immediately.
- **Expected:** The first search finds it. The second finds nothing. No sleep is needed between the write and the search.
- **Backing test:** `retrieval-search-consistency.spec.ts`

### 2 — Relevance holds on real prose, in both scripts ⭐
- **Steps:** Search the full real corpus for several topics you know it covers. Read the top hits. Repeat with a CJK query against the seeded CJK note.
- **Expected:** The top hits are the notes a reader would name. The CJK query finds its note.
- **Mock gap:** The consistency spec seeds a handful of documents. Relevance at real corpus scale is not covered anywhere.
- **Backing test:** `retrieval-search-consistency.spec.ts` (small corpus) · relevance at scale → `gap`

### 3 — An outward key gets real hits, scoped to what it may see
- **Steps:** Mint an outward API key. Open corpus retrieval on it. Query the real corpus and read one hit. Then query for something only a private entry holds.
- **Expected:** Real corpus rows come back ranked. Tool discovery shows only the opened tools. The private query returns nothing — no title, no body.
- **Backing test:** `api-key-facade.spec.ts`

### 4 — Losing the search engine degrades, it does not fail
- **Steps:** With a search engine configured, stop it. Search. Write a note. Search again. Restart it and search once more.
- **Expected:** Search falls back to Postgres full text with no 500. Writes still land. Recovery re-indexes what was written while it was down. The admin surface says it is degraded.
- **Note:** Drive this with `make dev-pgsearch-on`, which blanks `MEILI_URL` so the stack really takes the degraded path — before that instrument existed every search e2e had only ever exercised Meilisearch, so both halves looked equally green. **The admin surface saying "degraded" is the half that does not exist today** (F-S-3): `degrade` appears once in the whole backend and admin, about sigv1 nonces.
- **Backing test:** `retrieval-degrade.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Results are real hits from real content, never fixture rows and never a silent empty list on a term the corpus clearly contains.
An out-of-scope query returns nothing, and specifically not a private title as evidence that something was withheld.
