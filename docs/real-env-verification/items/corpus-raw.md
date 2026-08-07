# corpus-raw — Corpus: raw inbox ingest + clean excerpts

- **Status:** ✅ verified — 183 unprocessed, tab counts cross-view consistent, real vault content. The `mcp:verify` row (MCP-injected cruft, not in the vault) was DELETED 2026-08-07 while driving check 3, so the raw inbox is now exactly the vault mirror; the `*-test` notes ARE real vault notes and stay.
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
### 3 — Delete means delete: the button says what it does ⭐
- **Steps:** on a real raw row, first **attach an image** to it (see [[corpus-media]] check 9) → note the section count and the sidebar `badge-raw` → click the row's delete button → **read the confirm dialog before accepting** → accept → then check: (a) is the row gone from the list; (b) did the section count and the sidebar badge both drop by one; (c) is there still an `archived` tab in the filter row; (d) reload the whole page — does it come back; (e) open that image's object URL again.
- **Expected:** the button reads **delete** (not archive); the confirm says **"This cannot be undone"**; the entry is gone and stays gone across a reload; both counts move together; **no `archived` tab exists** — it never had a second half (nothing listed archived rows, nothing restored them), so it promised something the product could not do; the image is gone from the real bucket too (= [[corpus-media]] check 6 on raw).
- **⚠️ what this fixes — a name that lied:** the button used to read `archive` while posting DELETE (`RawRowList.tsx`). The owner pressed it believing the entry was recoverable. **The e2e was green throughout, because it asserted the DELETE fired and the row disappeared — and both halves were correct.** The lie was in the word, and no assertion covers a word.
- **⚠️ mock gap:** `admin-raw-crud.spec.ts` has no delete case at all; `tool-corpus-mutations.spec.ts` covers the API layer. The GUI half — button wording, confirm copy, the tab being gone — has no spec.
- **Backing test:** `tool-corpus-mutations.spec.ts` (raw really deletes, API level) · GUI half now covered by `admin-raw-crud.spec.ts` "deleting a raw entry moves the counters" (F-L-16)
- **Result:** ✅ — driven on prod 2026-08-07 against the one `mcp:verify` row (the only non-vault entry; deleting it made the corpus a true mirror again). (a) row gone ✅ (b) **counters did NOT move → F-L-16**, fixed and re-verified ⑤ (c) no `archived` tab ✅ (d) stays gone across a reload ✅ (e) the presigned object URL went 200 → **404**, so the image really left the MinIO bucket ✅.

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The admin/raw **list is non-empty** when raw exists; each **excerpt is clean rendered text** (F-R-1); the raw **count agrees with the list length** (F-L-4 family); import/export/promote affordances fire. The delete button's **verb matches what it does** (delete deletes; nothing labelled archive); the filter row holds **no tab whose backing query does not exist**; deleting one row moves the **list, the section count and the sidebar badge together** (F-L-4 family).

## Findings
(record here; also log `../findings.md`, ID `F-R-1` historical anchor)

- **F-R-1** (owner-reported mid-audit): card excerpts are substrings of raw markup (LaTeX `$$ \begin{aligned}…`, fenced ```` ```mermaid ````, `[[wikilinks]]`, `- ` bullets), cut mid-token. Should derive from rendered/plain text. 🔴 manual-red, needs step-3.
