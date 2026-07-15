# vault-sync — Vault: classify, tolerant-parse, tree, reconcile, export

- **Status:** ⬜ not-run
- **Module:** import the real Obsidian vault at scale — every folder routes to the right genre, the messy real frontmatter zoo parses without aborting the batch, the nested folder tree + folder-notes reproduce, re-sync/move/rename reconcile idempotently, hidden files bucket correctly, export round-trips, and the importer's view agrees with the vault's own `.scripts`.
- **Surface:** admin `/writings` → "import from Obsidian".
- **Real dep:** the **real** vault at `~/Develop/writing/notes` (409 real notes across `wiki/`/`raw/`/`subjectivity/`/`_templates/`, real `.obsidian/`, real `.scripts/`). No external credential.
- **Inherits (historical finding IDs):** `F-L-2` (source_path reconcile — ✅ fixed, errors 29→0, tree roots 24→5), `F-L-3` (subjectivity ingests without publish — ✅ fixed, rows 1→17).
- **Backing e2e:** `sync-a-routing` · `sync-b-tree` · `sync-c-title` · `sync-d-publish` · `sync-f-frontmatter` · `sync-g-hidden` · `sync-h-reconcile` · `sync-i-raw` · `sync-j-export` · `sync-k-raw-tree` · `sync-duplicate-title-collapse` · `corpus-sync-rename` · `corpus-tree-integrity` · `admin-obsidian`.

> CI's fixture vault is 3 in-memory `.md` strings (`makeVaultMD`); a 3-file fixture never exercises the tolerant-parse / reconcile / render paths the way 409 real notes do.

## Checks

### 1 — Classify at real scale  (was §L1)
- **Steps:** import the whole real vault → inspect the resulting genres. Every top-level folder must route right (`wiki/`→wiki, `subjectivity/`→subjectivity, `raw/`→raw inbox); `_templates/` and `.obsidian/`/`.scripts/` skipped; nothing under a known folder dropped or mis-routed.
- **Expected:** counts reconcile against `find wiki subjectivity -name '*.md'` (minus folder-notes/skips), zero silent drops; unknown top-level dirs + bare root files degrade gracefully.
- **⚠️ mock gap:** `sync-a-routing` only feeds a few synthetic folders; "hundreds of notes, deep real nesting, nothing dropped" is never asserted at scale.
- **Backing test:** `sync-a-routing.spec.ts` · `admin-obsidian.spec.ts`
- **Result:** ⬜

### 2 — Tolerant frontmatter on REAL notes ⭐  (was §L2)
- **Steps:** import and watch the parser survive the real frontmatter zoo (missing/partial/blank fm, malformed YAML — tabs, unquoted colons, smart quotes, mixed list/scalar; exotic keys; non-boolean `publish`; date strings vs objects; old-vs-new field names). Grep the worst offenders first.
- **Expected:** **no single bad note aborts the import** — malformed YAML tolerated, non-whitelist keys ignored, non-boolean `publish` coerced, body/frontmatter cleanly separated. Parse entrypoint: `import_parse.go:32 parseVaultMarkdown`. **The path most likely to break first on real data.**
- **⚠️ mock gap:** `sync-f-frontmatter` hand-authors a *curated* malformed set; real notes contain shapes the fixture never imagined.
- **Backing test:** `sync-f-frontmatter.spec.ts`
- **Result:** ⬜

### 3 — Node-tree + folder-note collapse + auto-node tolerance  (was §L3)
- **Steps:** on the real nested wiki tree confirm parent chains derive correctly; folder-notes (`foo/foo.md`) collapse into node `foo`; intermediate folders without a folder-note get an auto-placeholder; deep paths / collisions tolerated. Confirm `title = filename` and duplicate basenames across genres don't collapse.
- **Expected:** the real hierarchy reproduces as a clean parent/child tree with stable derived paths; missing-folder tolerance fills placeholders; a duplicate title across genres is **not** merged.
- **⚠️ mock gap:** the real vault nests far deeper than any fixture; `sync-duplicate-title-collapse` was itself a RED repro (reconcile claims notes BY TITLE across genres — `GetNoteByTitleAnyGenre`).
- **Backing test:** `sync-b-tree.spec.ts` · `sync-c-title.spec.ts` · `sync-duplicate-title-collapse.spec.ts` · `corpus-tree-integrity.spec.ts` · `sync-k-raw-tree.spec.ts`
- **Result:** ⬜

### 4 — Reconcile + idempotent re-sync + move/rename  (was §L4)
- **Steps:** import twice back-to-back (idempotency); move/rename a note (new `source_path`, stable slug) and re-import; move across genres; partial re-upload a subset.
- **Expected:** second import is a no-op/upsert; rename orphans the old node by design (slug-stable move updates in place); cross-genre move edits in place; partial upload is **upsert-only, never deletes** what it didn't include; publish gate applied.
- **⚠️ mock gap:** `corpus-sync-rename` notes obsidian-sync only ever tested the same-path re-import branch; real moves/renames at scale barely exercised.
- **Backing test:** `sync-h-reconcile.spec.ts` · `corpus-sync-rename.spec.ts` · `sync-i-raw.spec.ts` · `sync-d-publish.spec.ts` · `obsidian-sync.spec.ts`
- **Result:** ⬜

### 5 — Hidden-file harvest (two-layer)  (was §L9)
- **Steps:** confirm the two-layer hidden handling: **noise skipped** (`.git`/`.DS_Store`/`.trash`/`.claude`/`.scripts`/`_templates`/`workspace.json`/`app.json`), **config harvested** (`.obsidian/snippets/*.css` + `appearance.json`). "Handle hidden" ≠ "blanket-skip hidden".
- **Expected:** noise dropped, config harvested; the real `.obsidian/` yields owner-CSS config while `.scripts/`/`_templates/` contribute no notes.
- **⚠️ mock gap:** `sync-g-hidden` synthesizes the hidden set; the real `.obsidian/` has many more files to bucket (`community-plugins.json`, `graph.json`, …).
- **Backing test:** `sync-g-hidden.spec.ts`
- **Result:** ⬜

### 6 — Export round-trip + web-wins conflict  (was §L11, §L12)
- **Steps:** export the imported corpus back to a vault zip (genre→folder, tree→nested folders, note→`<title>.md`, folder-notes generated, `[[links]]` restored, frontmatter reconstructed) → diff a sample against originals → re-import the export (round-trip idempotent). Separately: edit a note on the web after import, re-sync from the vault → confirm the `web-wins` reconcile rule; partial re-uploads never delete.
- **Expected:** exported structure mirrors the real vault; links + frontmatter reconstruct; a second round-trip is stable; the web edit is preserved per `web-wins`; no data loss on re-sync.
- **⚠️ mock gap:** `sync-j-export` round-trips a tiny synthetic tree; `sync-h-reconcile` asserts web-wins only on synthetic single-note fixtures.
- **Backing test:** `sync-j-export.spec.ts` · `obsidian-sync.spec.ts` · `sync-h-reconcile.spec.ts`
- **Result:** ⬜

### 7 — `.scripts` contract alignment  (was §L14)
- **Steps:** run the vault's own real `.scripts/` (`check-links.sh`, `check-frontmatter.sh`, `normalize-names.sh`, `backfill-folder-notes.sh`, `check-notation.sh`, `notation-lint.py`) against `~/Develop/writing/notes` and compare their view (link graph, folder-note convention, name normalization, frontmatter validity) with what the importer derived.
- **Expected:** importer link set == `check-links.sh`; folder-note collapse == `backfill-folder-notes.sh`; name normalization == `normalize-names.sh`; frontmatter gate agrees with `check-frontmatter.sh`. The parser must not drift from the vault's scripts.
- **⚠️ mock gap:** the sync specs reference these contracts **only in comments**; no spec runs the real scripts and diffs. **No backing spec (gap)** — manual-only this round; candidate to promote into a real alignment test.
- **Backing test:** no backing spec (gap).
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The admin `/writings` obsidian import/export bar renders and **its buttons fire** (F-L-1 was a dead import/export affordance); vault stats (mode/notes/size/last-sync) render real numbers; the note count on screen reconciles with the imported list (F-L-4 count-vs-list family).

## Findings
(record here; also log `../findings.md`, ID `F-L-n` historical anchor)

- **F-L-2 ✅fixed** (source_path reconcile — real vault errors 29→0, tree roots 24→5). **F-L-3 ✅fixed** (subjectivity ingests without publish — rows 1→17). **F-L-1 ✅fixed** (page renders the real ObsidianBar import/export; export fires a real .zip). L1 classify ✓.
