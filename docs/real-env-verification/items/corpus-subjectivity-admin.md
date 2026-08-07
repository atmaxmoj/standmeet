# corpus-subjectivity-admin — Subjectivity has a face in the panel

- **Module:** Subjectivity is not an invisible genre that only MCP can write. It lists, creates, edits and carries files, through the same form and the same files panel as wiki and output — not a bespoke page.
- **Surface:** `/admin/subjectivity`, reached from the corpus group in the left nav.
- **Real dep:** The real vault's subjectivity notes, and a real MCP client for the parity check.
- **Backing e2e:** `genre-assets-admin-raw-subj` · `subjectivity-genre` · `sync-subjectivity-ingest` · `owner-mcp-parity-mutations`.

## Checks

### 1 — The nav entry opens and lists the real notes ⭐
- **Steps:** Find `subjectivity` in the corpus group. Open it. Count the rows. Compare that count against the subjectivity subtree in the role scope picker, and against what MCP reports for the same genre.
- **Expected:** All three agree, and the list is non-empty because the real vault holds these notes. Each row shows a title and a clean lead.
- **Note:** The way a freshly wired section fails is a working route with a wrong owner scope or genre filter, which produces a confident empty list. An empty list reads as a fact about the owner — "you have not written any" — so nobody investigates it.
- **Backing test:** `genre-assets-admin-raw-subj.spec.ts`

### 2 — Create and edit behave like every other genre
- **Steps:** Create a note with a title and body. Save. Find it in the list. Reopen it, change a sentence, save, reload. Then look for the citable switch and read what sits beside it.
- **Expected:** The form is the shared corpus form, not a special one. The edit sticks across the reload. The citable switch appears with its explanation, never bare (see [[corpus-acl-editing]]). The new note can then be selected in the role scope picker.
- **Backing test:** `genre-assets-admin-raw-subj.spec.ts`

### 3 — Files attach here as they do elsewhere
- **Steps:** Follow [[corpus-media]]'s attachment check on a note in this genre. Then set a cover and look at every visitor-facing surface.
- **Expected:** Attachment behaves as in other genres. Because this genre is private by default, setting a cover must not surface the note anywhere a visitor can reach.
- **Backing test:** `genre-assets-admin-raw-subj.spec.ts`

### 4 — Both ways of writing land in one place
- **Steps:** Create a note in the panel and read it back through a real MCP client. Then write one through MCP and reload the panel.
- **Expected:** Both arrive in the same list. The page's own claim that writing here and talking to your AI land in the same place is literally true.
- **Backing test:** `owner-mcp-parity-mutations.spec.ts` · `sync-subjectivity-ingest.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The nav entry opens a real page, not a 404 slug, and the list count matches the scope picker.
The form must NOT look different from wiki's — this genre spent its whole history being treated as a special case, and a fresh special case on screen is that illness returning.
The intro explains what the genre is, because a new owner cannot guess it from the word alone.
