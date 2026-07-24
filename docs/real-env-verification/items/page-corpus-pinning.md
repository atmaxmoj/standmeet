# page-corpus-pinning — homepage insights/projects = corpus pin windows

- **Status:** ⬜ not-run
- **Module:** the public page's insights/projects are ordered pin lists over the corpus (not a hand-maintained content store). Each pinned entry renders its title + excerpt and links into `/wiki/<path>`; a thought is stored once, in the corpus. Invariant **pinned ⊆ published** at both write ends (page.pin / admin PUT reject unpublished; unpublish auto-unpins + declares it). Design: `docs/design/page-corpus-pinning.md`.
- **Surface:** owner MCP (`page.pin` / `page.unpin`) + admin `/admin/page` (PinManager: pick / unpin / reorder over `GET /page/pinnable`) → public homepage `/`.
- **Real dep:** none external — real corpus + the publish toggle on the prod instance.
- **Backing e2e:** `page-corpus-pinning.spec.ts` (6) · `chatroom-layout` · `public-page` (empty-section).

## Checks

### 1 — Empty state + invariant honesty (pinned ⊆ published)
- **Steps:** open `/admin/page` with no published wiki entries → look at the PinManager picker.
- **Expected:** both sections show "no pins yet — this section is hidden on the page"; the picker says "nothing to pin — publish a corpus entry first". Consistent with the product's own surfaces (wiki rows badged "● private", `/admin/seo` indexing "pages 0").
- **Backing test:** `page-corpus-pinning.spec.ts` (pin-unpublished-rejected)
- **Result:** ⬜

### 2 — Publish → pin → homepage renders the card
- **Steps:** publish one wiki entry via the wiki editor's public-landing panel (excerpt + publish toggle) → back on `/admin/page`, confirm it now appears in the picker → pin it → save → open `/`.
- **Expected:** the homepage "things I've been thinking about" section appears with a card = the entry's title (link → `/wiki/<path>`) + its excerpt. Empty sections (projects, where) stay hidden, header included.
- **Backing test:** `page-corpus-pinning.spec.ts` (pin→homepage renders)
- **Result:** ⬜

### 3 — Unpublish a pinned entry → auto-unpin + card drops
- **Steps:** unpublish a currently-pinned entry (wiki editor publish toggle off, or MCP `seo.set_wiki_seo published:false`) → check `/admin/page` and `/`.
- **Expected:** the pin is removed from the section (the tool result / response declares which sections were touched); the homepage drops the card; if the section is now empty it hides entirely.
- **Backing test:** `page-corpus-pinning.spec.ts` (unpublish auto-unpins)
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The pinned card links into the real reader (not a second copy of the content); empty sections render nothing, header included; the picker only offers published entries; reorder ↑/↓ + unpin behave.

## Findings
(record real-env mismatches here during the manual phase; also log `../findings.md`)
