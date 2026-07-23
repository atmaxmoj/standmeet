# vault-links — Vault: wikilink graph over real `[[links]]`

- **Status:** ✅ verified (UPDATE, 2026-07-22) — ALL THREE closed on prod: F-L-10 (proximity resolution; 221-entry rebuild → `wiki/logic` backlinks 0→17 = vault ground truth), F-L-12 (`[[theory]]`/`[[engineering]]` render as `/wiki/…` anchors, 0 literal `[[`), F-L-13 (sub-entries rail lists both children). Verified on the invited `/wiki/cybernetics` via the new bearer-aware reader (F-L-11).
- **Module:** body `[[wikilinks]]` resolve by basename across genres into one unified `note_refs` edge table; `corpus_links` returns the outgoing/backlink sets the real body implies, agreeing with the vault's own `check-links.sh`.
- **Surface:** corpus (importer + `corpus_links` tool).
- **Real dep:** the real vault (`~/Develop/writing/notes`) with real cross-genre links, embeds, dangling links.
- **Backing e2e:** `sync-e-links` · `note-refs-unified` · `retrieval-links`.

## Checks

### 1 — Wikilink graph over real `[[links]]`  (was §L5)
- **Steps:** verify body `[[Title]]` links resolve by basename **across genres**, `|alias` and `#heading` are stripped, `![[embed]]` and code-fenced/inline-code links are skipped, unresolved links stay literal. Then read `corpus_links{path}` on a real note → outgoing + backlinks match the real `note_refs` edges. Cross-check against `.scripts/check-links.sh` — the sets should agree.
- **Expected:** `note_refs` is one unified edge table carrying all-genre `[[Title]]` backlinks; `corpus_links` returns the same outgoing/backlink sets the real body implies; `raw/` forward-links are legal (not forced to resolve); the importer's link set matches `check-links.sh`.
- **⚠️ mock gap:** fixtures resolve 2–3 hand-placed links; the real vault has cross-genre links, embeds, and dangling links at a density no fixture reproduces, and the `check-links.sh` alignment is asserted only in prose (see [[vault-sync]] check 7).
- **Backing test:** `sync-e-links.spec.ts` · `note-refs-unified.spec.ts` · `retrieval-links.spec.ts` · `wiki-reader-crosslink.spec.ts` · Go `wiki_crosslink_test.go`
- **Result:** ✅ (2026-07-22, prod) — cross-genre resolution now PROXIMITY-based (F-L-10): after the 221-entry `note_refs` rebuild, `wiki/logic` carries **17 backlinks (= the vault's own check-links ground truth)**, `raw/logic` keeps only its raw-source 2 (same-genre-correct); `stages-and-gates` 18, `math` 9, `engineering` 4. Rendered `[[links]]` are real `/wiki/…` anchors on the invited reader (0 literal `[[` on `/wiki/cybernetics`), and the backlinks/`cited_by` rail of well-linked notes is non-empty. LOOK satisfied.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Rendered `[[links]]` resolve to real note links (not left as literal `[[…]]` where they should resolve); backlinks panel (if shown) isn't empty on a well-linked note.

## Findings
(record here; also log `../findings.md`, ID `F-L-n` historical anchor)

- **L5 links ✓** (first pass).
