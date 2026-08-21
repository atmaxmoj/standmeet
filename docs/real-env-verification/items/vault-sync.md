# vault-sync — Vault: classify, tolerant-parse, tree, reconcile, export

- **Module:** Import the real vault at scale. Every folder routes to the right genre, the real frontmatter zoo parses without aborting the batch, the nested tree and folder-notes reproduce, re-sync and moves reconcile idempotently, an authoritative sync prunes what the vault no longer has, hidden files bucket correctly, export round-trips, and the importer's view agrees with the vault's own scripts.
- **Surface:** `/admin/writings` → the Obsidian import and export bar, and `/admin/obsidian` for vault stats.
- **Real dep:** The real vault at its real path, with its real hidden directories and its own scripts. No external credential.
- **Backing e2e:** `sync-a-routing` · `sync-b-tree` · `sync-c-title` · `sync-d-publish` · `sync-f-frontmatter` · `sync-g-hidden` · `sync-h-reconcile` · `sync-i-raw` · `sync-j-export` · `sync-k-raw-tree` · `sync-duplicate-title-collapse` · `corpus-sync-rename` · `corpus-tree-integrity` · `admin-obsidian`.

## Checks

### 1 — Everything routes, and nothing is silently dropped ⭐
- **Steps:** Import the whole vault. Count the notes per genre. Compare against what the filesystem holds, minus folder-notes and skipped directories. Look for a note that arrived under the wrong genre.
- **Expected:** The counts reconcile exactly. Template and script directories contribute no notes. An unknown top-level directory and a bare root file degrade gracefully rather than aborting or vanishing.
- **Mock gap:** The routing spec feeds a few synthetic folders. "Hundreds of notes, deep real nesting, nothing dropped" is never asserted at scale.
- **Backing test:** `sync-a-routing.spec.ts` · `admin-obsidian.spec.ts`

### 2 — No single bad note aborts the import ⭐
- **Steps:** Import with the real frontmatter in place: missing blocks, malformed YAML, tabs, unquoted colons, smart quotes, mixed list and scalar values, exotic keys, non-boolean publish flags, dates as strings and as objects. Grep the worst offenders first and confirm they arrived.
- **Expected:** Every note lands. Malformed YAML is tolerated, unknown keys are ignored, a non-boolean publish flag is coerced, and body and frontmatter separate cleanly.
- **Mock gap:** The frontmatter spec hand-authors a curated malformed set. Real notes contain shapes no fixture imagined, which is why this is the path most likely to break first on real data.
- **Backing test:** `sync-f-frontmatter.spec.ts`

### 3 — The real hierarchy reproduces as a tree
- **Steps:** Import and walk the tree. Check parent chains on deeply nested paths. Check that a folder-note collapses into its node. Check an intermediate folder with no folder-note. Check two notes with the same basename in different genres.
- **Expected:** Parent chains derive correctly with stable paths. Folder-notes collapse. Missing intermediate folders get a placeholder. Same-named notes in different genres stay separate — reconciling by title across genres is how they wrongly merge.
- **Backing test:** `sync-b-tree.spec.ts` · `sync-c-title.spec.ts` · `sync-duplicate-title-collapse.spec.ts` · `corpus-tree-integrity.spec.ts`

### 4 — A second import changes nothing
- **Steps:** Import twice back to back. Compare the corpus before and after.
- **Expected:** The second import is a no-op. Content is preserved, not rewritten.
- **Backing test:** `sync-h-reconcile.spec.ts`

### 5 — Moves and renames reconcile
- **Steps:** Move a note to a new path. Rename one. Move one across genres. Re-import after each. Then upload a subset of the vault.
- **Expected:** A move updates in place rather than duplicating. A cross-genre move edits in place. A partial upload only upserts what it did include: it never deletes the rest, and never edits or relocates the rest either. Count the notes per genre before and after — a partial upload that reports `deleted 0` can still have moved a note out of `raw` by claiming it under a shared title.
- **Backing test:** `corpus-sync-rename.spec.ts` · `sync-h-reconcile.spec.ts` · `sync-i-raw.spec.ts`

### 6 — An authoritative sync prunes what the vault no longer has ⭐
- **Steps:** Sync the vault. Delete one note and one whole folder from the vault. Sync again as authoritative. Read the corpus tree and the link graph.
- **Expected:** The deleted note and folder are gone from the corpus, and no edge to them survives. After an authoritative sync the corpus equals the vault.
- **Note:** This is deliberately different from a partial upload, which must never delete. Only a sync that declares itself authoritative may prune, so the two modes must stay distinguishable.
- **Backing test:** `sync-h-reconcile.spec.ts` covers upsert only · pruning → `gap`

### 7 — Hidden files are bucketed, not blanket-skipped
- **Steps:** Import with the real hidden directories present. Check that version-control, OS and script directories contribute no notes. Then check that the editor config directory's stylesheet and its enabled-list were harvested.
- **Expected:** Noise is dropped and config is harvested. Handling hidden files is not the same as skipping them.
- **Mock gap:** The hidden-file spec synthesizes its set. The real config directory holds many more files to bucket.
- **Backing test:** `sync-g-hidden.spec.ts`

### 8 — Export round-trips, and a web edit survives a re-sync
- **Steps:** Export the corpus back to a vault archive. Diff a sample against the originals. Re-import the export. Separately, edit a note on the web, then re-sync from the vault.
- **Expected:** The exported structure mirrors the vault — genres as folders, tree as nesting, folder-notes generated, links restored, frontmatter reconstructed. A second round-trip is stable. The web edit survives the re-sync per the conflict rule, and no data is lost.
- **Mock gap:** The export spec round-trips a tiny synthetic tree, and the conflict rule is asserted on a single synthetic note.
- **Backing test:** `sync-j-export.spec.ts` · `sync-h-reconcile.spec.ts`

### 9 — The importer's view matches the vault's own scripts
- **Steps:** Run the vault's own scripts over the vault: the link checker, the frontmatter checker, the name normalizer, the folder-note backfill. Compare each result against what the importer derived.
- **Expected:** The link sets match. Folder-note collapse matches the backfill's expectation. Name normalization matches. The frontmatter gate agrees.
- **Mock gap:** The sync specs reference these contracts only in comments. Nothing runs the scripts and diffs, so the parser can drift from the vault's own rules without anything noticing.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The import and export bar renders and its buttons actually fire — a dead affordance has lived here before.
Vault stats show real numbers, and the note count on screen reconciles with the imported list.
After a sync, ask the sharper question: does the corpus now equal the vault, or only contain it?
