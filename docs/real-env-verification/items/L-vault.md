# §L — Real Obsidian vault (sync + render)

- **Status:** ⬜ not-run
- **Scope:** runnable-now (real vault, no external credential needed — **priority #1**)
- **Prereqs/creds:** the **real** vault at `~/Develop/writing/notes` — 409 real `.md` notes across the four real top-level folders (`wiki/`, `raw/`, `subjectivity/`, `_templates/`), a real `.obsidian/` (`snippets/theorem-callouts.css`, `appearance.json`, `community-plugins.json`, `workspace.json`, …), and a real `.scripts/` (`check-links.sh`, `normalize-names.sh`, `backfill-folder-notes.sh`, `check-frontmatter.sh`, `check-notation.sh`, `notation-lint.py`). Real math/diagrams live under `wiki/cybernetics/…` and `wiki/optimization/…`. No `verify-creds.env` entry required.
- **Real service:** the real Obsidian vault (hundreds of notes, messy real-world frontmatter, real KaTeX/Mermaid/TikZ/`standmeet-query`, real nested folder trees, real `[[wikilinks]]`) — replacing CI's **synthetic fixture vault**: every sync/render spec hand-builds a handful of in-memory `.md` strings via `makeVaultMD` and posts them as a multipart "vault" (`e2e/fixtures/obsidian.ts:84 makeVaultMD`, `:26 uploadVault`). A 3-file fixture never exercises the tolerant-parse / reconcile / render paths the way 409 real notes do.
- **Backing e2e:** (attribution targets) `sync-a-routing` · `sync-b-tree` · `sync-c-title` · `sync-d-publish` · `sync-e-links` · `sync-f-frontmatter` · `sync-g-hidden` · `sync-h-reconcile` · `sync-i-raw` · `sync-j-export` · `sync-k-raw-tree` · `sync-duplicate-title-collapse` · `corpus-sync-rename` · `corpus-tree-integrity` · `note-refs-unified` · `retrieval-links` · `retrieval-search-consistency` · `obsidian-sync` · `admin-obsidian` · `render-cssclasses` · `cssclasses-surfaces` · `render-callouts` · `render-tikz` · `render-widget` · `writing-math-mermaid` · `document-render` · `visitor-chat-answer-render` · `query-render` · `query-errors` · `query-acl` · `render-static-passthrough` · `leverage-static-html` · `prerender-passthrough` · `render-owner-css` · `owner-css-security` · `owner-css-bypass` · `owner-css-edit` · `document-render-benchmark`

> One-time setup: on the prod stack (`make prod-up`), claim a fresh owner, then import the **real** vault — either via admin `/writings` → "import from Obsidian" (pointed at `~/Develop/writing/notes`) or the same multipart route the e2e helper drives, but sourced from the real directory tree rather than `makeVaultMD` strings. Sync should complete with all real notes routed. Only then can the sub-items run.

## Sub-items

### L1 — Classify at real scale
- **Steps:** import the whole real vault → inspect the resulting genres. Every top-level folder must route to the right genre (`wiki/`→wiki, `subjectivity/`→subjectivity, `raw/`→raw inbox); `_templates/` and `.obsidian/`/`.scripts/` must be skipped as non-content; nothing under a known folder may be dropped or mis-routed.
- **Expected:** wiki notes land in `wiki`, subjectivity notes in `subjectivity` (owner-only), raw notes in the raw inbox; note count reconciles against `find wiki subjectivity -name '*.md'` (minus folder-notes/skips), zero silent drops. Unknown top-level dirs and bare root files degrade gracefully (skipped, no crash).
- **⚠️ mock gap:** `sync-a-routing` only ever feeds a few synthetic folders (`makeVaultMD`); "hundreds of notes, deep real nesting, nothing dropped" is never asserted at scale.
- **Backing test:** `sync-a-routing.spec.ts` · `admin-obsidian.spec.ts` (vault stats: mode/notes/size/last-sync)
- **Result:** ⬜

### L2 — Tolerant frontmatter on REAL notes ⭐
- **Steps:** import and watch the parser survive the real frontmatter zoo. On real notes expect: missing frontmatter entirely, partial/blank fm, malformed YAML (tabs, unquoted colons, smart quotes, mixed list/scalar), exotic keys (`cssclasses`, `aliases`, `tags` in both `[a,b]` and `- a`/`- b` forms), non-boolean `publish`, dates as strings vs objects, and old-vs-new field names. Grep the real vault first to find the worst offenders, then confirm each parses without aborting the batch.
- **Expected:** **no single bad note aborts the import** — malformed YAML is tolerated (note still ingested with what could be parsed), non-whitelist keys ignored (not a batch failure), non-boolean `publish` coerced, body/frontmatter cleanly separated. Sync stays lenient (the vault-side `check-frontmatter.sh` is the real gate, not the importer).
- **⚠️ mock gap:** `sync-f-frontmatter` hand-authors a *curated* set of "malformed" cases; real notes will contain YAML shapes the fixture never imagined. The parse entrypoint is `backend/internal/usecases/obsidian/import_parse.go:32 parseVaultMarkdown` — verify a real messy note doesn't panic or drop there. **This is the path most likely to break first on real data.**
- **Backing test:** `sync-f-frontmatter.spec.ts`
- **Result:** ⬜

### L3 — Node-tree + folder-note collapse + auto-node tolerance
- **Steps:** on the real nested wiki tree (e.g. `wiki/cybernetics/theory/stages-and-gates/necessity/derivations/…`) confirm parent chains are derived correctly; folder-notes (`foo/foo.md`) collapse into node `foo` (convention A, per `backfill-folder-notes.sh`); intermediate folders **without** a folder-note get an auto-created empty placeholder node; name collisions / very deep paths are tolerated. Confirm `title = filename` (fm `title`/`slug`/`path` ignored, per `_templates` contract) and that duplicate basenames across genres don't silently collapse.
- **Expected:** the real folder hierarchy reproduces as a clean parent/child tree with stable derived paths; missing-folder tolerance fills placeholders; unicode/space filenames coerce (hyphenation) without error; a duplicate title across genres does **not** get merged into one node.
- **⚠️ mock gap:** the real vault has far deeper nesting and more folder-notes than any fixture; `sync-duplicate-title-collapse` was itself a RED bug repro (reconcile claims notes BY TITLE across all genres — `GetNoteByTitleAnyGenre`), so real duplicate basenames are a live hazard.
- **Backing test:** `sync-b-tree.spec.ts` · `sync-c-title.spec.ts` · `sync-duplicate-title-collapse.spec.ts` · `corpus-tree-integrity.spec.ts` · `sync-k-raw-tree.spec.ts` (nested `raw/` → tree, #151)
- **Result:** ⬜

### L4 — Reconcile + idempotent re-sync + move/rename
- **Steps:** import the real vault twice back-to-back (idempotency); then move/rename a real note (new `source_path`, stable slug) and re-import; then move a note across genres; then do a partial re-upload (a subset of notes).
- **Expected:** second import is a no-op / upsert (same state, no dupes); rename orphans the old node **by design** (slug-stable move updates in place, `normalize-names.sh` repoints); cross-genre move edits genre in place; partial upload is **upsert-only, never deletes** the notes it didn't include (`partial-never-delete`); publish gate (`publish:true` in, `false`/missing skipped for leaves; folder-notes built as tree nodes regardless of publish but their own `corpus_read` still gated).
- **⚠️ mock gap:** `corpus-sync-rename` explicitly notes obsidian-sync only ever tested the *same-path* re-import branch before it; real moves/renames at scale (with real slugs) are barely exercised.
- **Backing test:** `sync-h-reconcile.spec.ts` · `corpus-sync-rename.spec.ts` · `sync-i-raw.spec.ts` · `sync-d-publish.spec.ts` · `obsidian-sync.spec.ts`
- **Result:** ⬜

### L5 — Wikilink graph over real `[[links]]`
- **Steps:** on the real vault, verify body `[[Title]]` links resolve by basename **across genres**, `|alias` and `#heading` are stripped, `![[embed]]` and code-fenced/inline-code links are skipped, and unresolved links stay literal. Then read `corpus_links{path}` on a real note → outgoing + backlinks match the real `note_refs` edges. Cross-check against the vault's own `.scripts/check-links.sh` (the contract `sync-e-links` aligns to): the sets should agree.
- **Expected:** `note_refs` is one unified edge table carrying all-genre `[[Title]]` backlinks; `corpus_links` returns the same outgoing/backlink sets the real body implies; `raw/` forward-links are legal (not forced to resolve); the importer's link set matches `check-links.sh` output on the real vault.
- **⚠️ mock gap:** fixtures resolve 2–3 hand-placed links; the real vault has cross-genre links, embeds, and dangling links at a density no fixture reproduces, and the `check-links.sh` alignment is asserted only in prose, not run against the real script (see L14).
- **Backing test:** `sync-e-links.spec.ts` · `note-refs-unified.spec.ts` · `retrieval-links.spec.ts`
- **Result:** ⬜

### L6 — Real attachments / images
- **Steps:** import a real note that references an image; confirm the attachment (non-`.md`) becomes a media object in the store (not a note), body `![[img]]`/`![](img)` rewrites to the object URL, `cover_image` frontmatter inlines to a `pending-<uuid>` ref then resolves, and `canonicalExt` normalizes the extension. Export and confirm bytes round-trip.
- **Expected:** attachment lands as media (exactly the notes count for `.md`, images excluded from note count); presigned/object URL renders; export writes the blob into `attachments/` with byte-identical content.
- **⚠️ mock gap:** `sync-g-hidden` uses a synthetic 1×1 PNG; real vaults carry heavier/varied image types and real `cover_image` refs.
- **Backing test:** `sync-g-hidden.spec.ts` (attachment-not-note) · `obsidian-sync.spec.ts` (image attachment round-trip)
- **Result:** ⬜

### L7 — CSS snippet harvest from real `.obsidian/snippets/`
- **Steps:** import with the real `.obsidian/snippets/theorem-callouts.css` present + `appearance.json` enabled-list → owner CSS is **harvested** (not skipped). Confirm it's sanitized (strip `@import` / external `url()` / `expression` / `javascript:`) and scoped to `.corpus-content`, then renders on a published wiki note.
- **Expected:** the real snippet's rules survive sanitize+scope (safe rules kept — positive guard), apply inside `.corpus-content`, and cannot touch app chrome; the enabled-list in `appearance.json` decides which snippets are active.
- **⚠️ mock gap:** fixtures feed a tiny synthetic CSS string; the real `theorem-callouts.css` is the first real-world sanitize target.
- **Backing test:** `owner-css-edit.spec.ts` (vault-sync face parity) · `render-owner-css.spec.ts` · `owner-css-security.spec.ts` · `owner-css-bypass.spec.ts`
- **Result:** ⬜

### L8 — `cssclasses` frontmatter
- **Steps:** find real notes with `cssclasses:` frontmatter → confirm the classes are captured on sync and re-emitted on the note container at render; verify tri-surface parity (sync-captured == admin note-edit `css_classes` == MCP write-tool `css_classes`).
- **Expected:** whichever surface set a class, the read-back is identical and the class lands on the note's render container.
- **Backing test:** `render-cssclasses.spec.ts` · `cssclasses-surfaces.spec.ts`
- **Result:** ⬜

### L9 — Hidden-file harvest (two-layer)
- **Steps:** confirm the two-layer hidden handling on the real `.obsidian/`: **noise layer skipped** (`.git`/`.DS_Store`/`.trash`/`.claude`/`.scripts`/`_templates`/`workspace.json`/`app.json`), **config layer harvested** (`.obsidian/snippets/*.css` + `appearance.json`). "Handle hidden" ≠ "blanket-skip hidden".
- **Expected:** noise dropped, config harvested; the real `.obsidian/` yields owner-CSS config while `.scripts/`/`_templates/` contribute no notes.
- **⚠️ mock gap:** `sync-g-hidden` synthesizes the hidden set; the real `.obsidian/` has many more files (`community-plugins.json`, `graph.json`, `core-plugins.json`, `plugins/`) to correctly bucket.
- **Backing test:** `sync-g-hidden.spec.ts`
- **Result:** ⬜

### L10 — Render face on REAL content ⭐
- **Steps:** render real notes end-to-end (importer → reader / visitor chat markdown pipeline) and check every heavy render face the real vault actually contains:
  - **KaTeX** — real `$$…$$` / `$…$` in the cybernetics/optimization notes render as math, no raw TeX leak, no ENOENT.
  - **Mermaid** — real ` ```mermaid ` fences render as diagrams (KaTeX 0.16 + mermaid 11 pipeline, shared with chat/wiki/output).
  - **TikZ** — real TikZ blocks render via the underlying lib (not an Obsidian plugin), no hang.
  - **Callouts** — real `> [!type] Title` → `blockquote.callout[data-callout=type]`.
  - **`standmeet-query`** — real ` ```standmeet-query ` blocks server-side-resolve into a live ACL-scoped list (Dataview-like on real DB), not left as a raw block; malformed DSL / unknown fields degrade (literal or friendly notice, capped result), and the query is **not** an authorization oracle (owner-only `subjectivity` never listed to a wiki-only visitor).
  - **`standmeet-html` / `standmeet-widget`** — sandbox iframe blocks render.
  - **Static pass-through** — Dataview/Templater pre-rendered on the Obsidian side at export are ingested as static markdown (StandMeet never runs Obsidian plugins) and rendered whole.
- **Expected:** every face renders correctly on real content — no ENOENT, no hang, no sanitize-strip of legitimate math/diagrams, XSS still sanitized. Match the design (`rendering-and-extensibility.md`) pixel-intent.
- **⚠️ mock gap:** each render spec uses a single synthetic snippet; the real vault mixes all of these in one note and carries genuinely complex math/orbit notes. **This is the second path most likely to break first on real data** (KaTeX macro gaps, mermaid parse edge cases, TikZ toolchain ENOENT/timeout, a `standmeet-query` DSL the fixture never wrote).
- **Backing test:** `writing-math-mermaid.spec.ts` · `document-render.spec.ts` · `visitor-chat-answer-render.spec.ts` · `render-callouts.spec.ts` · `render-tikz.spec.ts` · `render-widget.spec.ts` · `query-render.spec.ts` · `query-errors.spec.ts` · `query-acl.spec.ts` · `render-static-passthrough.spec.ts` · `leverage-static-html.spec.ts` · `prerender-passthrough.spec.ts`
- **Result:** ⬜

### L11 — Export round-trip
- **Steps:** export the imported real corpus back to a vault zip → each genre → its folder, tree → nested folders, note → `<title>.md`, folder-notes generated, `[[links]]` restored, frontmatter reconstructed. Diff a sample of exported notes against the originals; re-import the export and confirm stable state (round-trip idempotent).
- **Expected:** exported structure mirrors the real vault's folder/tree shape; links and frontmatter reconstruct; a second round-trip is stable.
- **⚠️ mock gap:** `sync-j-export` round-trips a tiny synthetic tree; real folder-note generation and link restoration at 409-note scale is untested.
- **Backing test:** `sync-j-export.spec.ts` · `obsidian-sync.spec.ts`
- **Result:** ⬜

### L12 — Web-wins conflict
- **Steps:** edit a note on the web (admin) after import, then re-sync the same note from the vault → confirm the reconcile policy resolves in favor of the web edit where designed (`web-wins`), and partial re-uploads never delete.
- **Expected:** web edit is preserved per the `web-wins` reconcile rule; no data loss on re-sync; batch parse tolerates forward-refs.
- **⚠️ mock gap:** the web-wins branch is asserted only on synthetic single-note fixtures in `sync-h-reconcile`.
- **Backing test:** `sync-h-reconcile.spec.ts`
- **Result:** ⬜

### L13 — Scale / perf + real `corpus_search` relevance
- **Steps:** with the full real corpus indexed on a pinned prod Meili, run `corpus_search` over real content: write-then-search consistency (`WaitForTask` strong consistency), delete-then-miss, mixed CJK+EN relevance (the real vault is English but confirm the CJK path stays correct against a seeded CJK note). Time a representative reader render across the heavy real notes (loose upper bound, regression smoke).
- **Expected:** written notes are immediately searchable and deleted ones immediately gone; CJK query hits its note; relevance is sane on real prose; render timings don't regress sharply.
- **⚠️ mock gap:** `retrieval-search-consistency` seeds a handful of docs (incl. one CJK note, "A9 中文搜索命中"); real relevance/latency at corpus scale is not covered, and **the degrade-to-PG-FTS fallback (kill Meili → clean PG path) has no backing spec here — that failure mode is §P5's territory (gap for §L)**.
- **Backing test:** `retrieval-search-consistency.spec.ts` (Meili read/write consistency + CJK) · `document-render-benchmark.spec.ts` (render timing smoke). Meili→PG-FTS fallback: no backing spec (gap).
- **Result:** ⬜

### L14 — `.scripts` contract alignment
- **Steps:** run the vault's own real `.scripts/` against `~/Develop/writing/notes` (`check-links.sh`, `check-frontmatter.sh`, `normalize-names.sh`, `backfill-folder-notes.sh`, `check-notation.sh`, `notation-lint.py`) and compare their view of the vault (link graph, folder-note convention, name normalization, frontmatter validity) with what the importer derived. Any divergence between the vault's canonical scripts and the importer's assumptions is a finding.
- **Expected:** the importer's link set == `check-links.sh`; folder-note collapse == `backfill-folder-notes.sh` convention; name normalization == `normalize-names.sh`; frontmatter gate agrees with `check-frontmatter.sh`. The parser's assumptions must not drift from the vault's actual scripts.
- **⚠️ mock gap:** the sync specs reference these contracts **only in comments** (`sync-e-links` ↔ `check-links.sh`, `sync-b-tree` ↔ `backfill-folder-notes.sh`, `sync-c-title` ↔ `_templates`); no spec actually executes the real scripts and diffs. **No backing spec (gap)** — a manual-only comparison this round; candidate to promote into a real alignment test.
- **Backing test:** no backing spec (gap) — contract asserted only in sync-spec prose; run the real `.scripts/` by hand and diff.
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-L-n`)
