# vault-links — Vault: wikilink graph over real `[[links]]`

- **Module:** Body `[[wikilinks]]` resolve by basename across genres into one unified `note_refs` edge table. `corpus_links` returns the outgoing and backlink sets the real body implies. The reader renders resolved links as anchors.
- **Surface:** The corpus importer, the `corpus_links` tool, and the reader (`/wiki/<path>` body and its backlinks rail).
- **Real dep:** The real vault (`~/Develop/writing/notes`), with its cross-genre links, embeds and dangling links.
- **Backing e2e:** `sync-e-links` · `note-refs-unified` · `retrieval-links` · `wiki-reader-crosslink` · Go `wiki_crosslink_test.go`.

## Checks

### 1 — A link resolves by basename, across genres ⭐
- **Steps:** Pick a note whose body links `[[Title]]` where Title lives in a different genre. Import it. Read `corpus_links{path}` for that note.
- **Expected:** The link resolves to the entry with that basename. The edge appears in `note_refs`. `raw/` forward links are legal and are not forced to resolve.
- **Mock gap:** Fixtures resolve two or three hand-placed links. The real vault's density of cross-genre links, embeds and dangling links is not reproduced anywhere.
- **Backing test:** `sync-e-links.spec.ts` · `note-refs-unified.spec.ts`

### 2 — The link syntax is parsed, not pattern-matched
- **Steps:** Use a note carrying `[[Title|alias]]`, `[[Title#heading]]`, `![[embed]]`, a link inside a code fence, and a link inside inline code. Import it. Read the edges.
- **Expected:** `|alias` and `#heading` are stripped before resolution. The embed and both code-wrapped links produce no edge. An unresolved link stays literal in the body.
- **Backing test:** `sync-e-links.spec.ts`

### 3 — The graph agrees with the vault's own checker
- **Steps:** Run `.scripts/check-links.sh` over the vault. Compare its link set against the importer's `note_refs`.
- **Expected:** The two sets agree. A note the vault says has N backlinks has N in `note_refs`.
- **Mock gap:** This alignment is asserted only in prose. Nothing runs both and diffs them (see [[vault-sync]]).
- **Backing test:** `gap`

### 4 — The reader renders resolved links as anchors
- **Steps:** Open a well-linked note in the reader. Read the body. Read the backlinks rail.
- **Expected:** Every resolvable `[[link]]` renders as an anchor to the target note. No literal `[[` survives where a link resolved. The backlinks rail is non-empty on a well-linked note.
- **Backing test:** `wiki-reader-crosslink.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Read a body cold: a literal `[[…]]` on screen means either a broken resolver or a dangling link, and the two must be distinguishable.
The backlinks rail on a heavily-linked note is never empty.
A count of backlinks shown anywhere agrees with what the vault itself would compute.
