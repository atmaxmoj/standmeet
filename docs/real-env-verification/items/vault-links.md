# vault-links — Vault: wikilink graph over real `[[links]]`

- **Status:** ⬜ not started (new round)
- **Module:** body `[[wikilinks]]` resolve by basename across genres into one unified `note_refs` edge table; `corpus_links` returns the outgoing/backlink sets the real body implies, agreeing with the vault's own `check-links.sh`.
- **Surface:** corpus (importer + `corpus_links` tool).
- **Real dep:** the real vault (`~/Develop/writing/notes`) with real cross-genre links, embeds, dangling links.
- **Backing e2e:** `sync-e-links` · `note-refs-unified` · `retrieval-links`.

## Checks

### 1 — Wikilink graph over real `[[links]]`  (was §L5)
- **Steps:** verify body `[[Title]]` links resolve by basename **across genres**, `|alias` and `#heading` are stripped, `![[embed]]` and code-fenced/inline-code links are skipped, unresolved links stay literal. Then read `corpus_links{path}` on a real note → outgoing + backlinks match the real `note_refs` edges. Cross-check against `.scripts/check-links.sh` — the sets should agree.
- **Expected:** `note_refs` is one unified edge table carrying all-genre `[[Title]]` backlinks; `corpus_links` returns the same outgoing/backlink sets the real body implies; `raw/` forward-links are legal (not forced to resolve); the importer's link set matches `check-links.sh`.
- **⚠️ mock gap:** fixtures resolve 2–3 hand-placed links; the real vault has cross-genre links, embeds, and dangling links at a density no fixture reproduces, and the `check-links.sh` alignment is asserted only in prose (see [[vault-sync]] check 7).
- **Backing test:** `sync-e-links.spec.ts` · `note-refs-unified.spec.ts` · `retrieval-links.spec.ts`
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Rendered `[[links]]` resolve to real note links (not left as literal `[[…]]` where they should resolve); backlinks panel (if shown) isn't empty on a well-linked note.

## Findings
(record here; also log `../findings.md`, ID `F-L-n` historical anchor)

- **L5 links ✓** (first pass).
