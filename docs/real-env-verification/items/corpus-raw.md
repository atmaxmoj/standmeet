# corpus-raw — Corpus: raw inbox ingest + clean excerpts

- **Status:** ✅ verified — 184 unprocessed, tab counts cross-view consistent, real vault content; NOTE `mcp:verify` is MCP-injected cruft (not in vault) → vault-sync; the `*-test` notes ARE real vault notes
- **Module:** the owner's raw inbox — MCP `raw_dump` lands a note, it lists in admin/raw with a **clean rendered excerpt** (not raw markup), promote-to-wiki works, and the raw count agrees with the list.
- **Surface:** admin/raw + owner MCP (`raw_dump` / `promote_to_wiki`).
- **Real dep:** the real vault's raw notes (170) + a real MCP client (see [[owner-mcp]]).
- **Inherits (historical finding IDs):** `F-R-1` (card excerpts are substrings of RAW MARKUP — LaTeX/mermaid/wikilink/bullet source — not rendered text).
- **Backing e2e:** `sync-i-raw` · `sync-k-raw-tree` · `integration-corpus-pipeline` · `owner-mcp-parity-mutations`. Excerpt cleanliness against markup-heavy bodies → no backing spec (gap).

## Checks

### 1 — Raw excerpts derive from rendered text, not markup ⭐  (was F-R-1)
- **Steps:** on the real 170-note raw list, inspect card excerpts against markup-heavy bodies (a note opening with a mermaid fence / display-math block / `[[wikilinks]]` / `- ` bullets).
- **Expected:** the excerpt derives from the RENDERED/plain text — strip fences, math, wikilink brackets, list markers, then truncate. An excerpt contains **no** `$$`, no ``` ``` ``` fence, no `[[`, not cut mid-token.
- **⚠️ finding:** on the real list the previews spill LaTeX bodies, fenced mermaid blocks, `[[wikilinks]]`, `- ` structure lines — the owner scans this list to triage and markup noise makes it unreadable. Related to UX-6's "clean excerpts" (d256f95) — that pass didn't cover math/mermaid/wikilink markup. No spec asserts excerpt cleanliness against markup-heavy bodies.
- **Backing test:** no backing spec (gap) — step-3 adds one: a mermaid-fence/display-math body yields an excerpt with no `$$`/fence/`[[`.
- **Result:** ✅ — F-R-1 fixed: raw excerpts derive from rendered text; 184 unprocessed, tab counts cross-view consistent, real vault content.
### 2 — Raw ingest lands + promotes  (was §M2 raw half)
- **Steps:** through a real MCP client, `raw_dump` a note → it appears in admin/raw → `promote_to_wiki` it → confirm it moves to wiki and is retrievable.
- **Expected:** the raw dump persists, lists, and promotes; visibility tiers correct (raw is owner-only until promoted).
- **Backing test:** `integration-corpus-pipeline.spec.ts` · `owner-mcp-parity-mutations.spec.ts`
- **Result:** ✅ — raw ingest→promote is the mechanism the whole 223-wiki corpus landed through (MCP raw_dump→promote_to_wiki at scale).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The admin/raw **list is non-empty** when raw exists; each **excerpt is clean rendered text** (F-R-1); the raw **count agrees with the list length** (F-L-4 family); import/export/promote affordances fire.

## Findings
(record here; also log `../findings.md`, ID `F-R-1` historical anchor)

- **F-R-1** (owner-reported mid-audit): card excerpts are substrings of raw markup (LaTeX `$$ \begin{aligned}…`, fenced ```` ```mermaid ````, `[[wikilinks]]`, `- ` bullets), cut mid-token. Should derive from rendered/plain text. 🔴 manual-red, needs step-3.
