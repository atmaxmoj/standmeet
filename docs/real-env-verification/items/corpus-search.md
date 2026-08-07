# corpus-search — Corpus: search relevance + ACL + PG fallback

- **Module:** `corpus_search` over real content returns relevant hits, is consistent immediately after a write, and is scoped by the caller's ACL. It is correct on the Postgres full-text path, which is what prod runs by default because prod ships without a search engine. The API-key facade dispatches the same real search.
- **Surface:** Visitor chat retrieval, the outward API-key facade, and the backend search itself.
- **Real dep:** The full real corpus indexed on the prod stack. A seeded CJK note, because the real vault is English and the CJK path needs its own input.
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
- **Note:** Prod's default is already the fallback path, so verify the fallback as the primary, not as an emergency.
- **Backing test:** `retrieval-degrade.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Results are real hits from real content, never fixture rows and never a silent empty list on a term the corpus clearly contains.
An out-of-scope query returns nothing, and specifically not a private title as evidence that something was withheld.
