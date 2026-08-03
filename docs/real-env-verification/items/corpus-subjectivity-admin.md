# corpus-subjectivity-admin — Subjectivity finally has a face in the panel

- **Status:** ⬜ not-run
- **Module:** subjectivity stops being the invisible genre only MCP could write. It lists, it creates, it edits, it carries files — through the **same** form and the same files panel as wiki and output, not a bespoke page.
- **Surface:** `/admin/subjectivity` (new) + the corpus group in the left nav.
- **Real dep:** prod stack + the real vault's subjectivity notes.
- **Inherits (historical finding IDs):** `F-A-15` (subjectivity was neither listed nor browsable in admin — the direct ancestor of this page).
- **Backing e2e:** `genre-assets-admin-raw-subj` (panel create / edit / files) · `subjectivity-genre` · `sync-subjectivity-ingest`.

> **Why the panel can write this genre at all.** The op used to carry `fp.Only(reason, "mcp")` with the reason *"the owner's self-model is written by thinking out loud with their own AI, not filled into a form"*. That read exactly like a product decision — it had a rationale, and it sat in the field that expresses exposure intent. It was **a preference someone wrote into the code**, and it had never been tested against the owner. Worth remembering when a constraint blocks a build: check whether anything has ever tried to go around it. Nothing had — not because the rule held, but because nobody had reached for this genre in the panel.

## Checks

### 1 — It is in the nav, it opens, and it lists the real notes
- **Steps:** log into admin → find `subjectivity` in the corpus group → open it → count the rows, and compare that number against the subjectivity subtree in the `/admin/roles` corpus scope picker and against MCP `corpus.list{genre:subjectivity}`.
- **Expected:** all three agree. The list is non-empty (the real vault has these), each row shows a title and a clean lead.
- **⚠️ count-vs-list family** (F-D-1 / F-L-4 / [[admin-shell]] check 2): the classic way a freshly wired section breaks is that the route works but the owner scope or the genre filter is wrong → a confident empty list. **An empty list reads as a fact** ("you haven't written any"), so nobody investigates it.
- **Result:** ⬜

### 2 — Create one, edit one — the same actions as every other genre
- **Steps:** click `+ new note` → fill title and body → save → it appears in the list → reopen it, change a sentence, save, reload and confirm the change stuck. Notice whether the `citable` checkbox is there, and whether its explanation is next to it.
- **Expected:** the form looks like the wiki edit form (it is the same `CorpusEntryForm`); the citable switch appears **with** its explanation ([[corpus-acl-editing]] check 4: this switch must never appear bare). The note you just created can then be ticked in the `/admin/roles` scope picker tree.
- **Result:** ⬜

### 3 — Attach files (the same run as [[corpus-media]] check 9, on this genre)
- **Steps:** see [[corpus-media]] check 9.
- **Expected:** same. **Watch the hero specifically:** this genre is private by default — setting a cover must not surface the note anywhere a visitor can see.
- **Result:** ⬜

### 4 — "Write here or talk to your AI" is literally true
- **Steps:** create a note in the panel → read it back through a real MCP client with `corpus.list{genre:subjectivity}`; then write one through MCP `subjectivity_write` → reload the panel and look for it.
- **Expected:** both arrivals land in one place. The intro line on the page ("Write here or by talking to your AI; both land in the same place") is a statement of fact, not a slogan.
- **Backing test:** `owner-mcp-parity-mutations.spec.ts` · `sync-subjectivity-ingest.spec.ts`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The nav entry actually opens (not a 404 slug); the list is non-empty and its count matches the ACL picker; the form **must not look different** from wiki's — this genre's entire history is being treated as a special case, and a fresh special case on screen is the same illness returning. The intro explains what the genre *is*: a new owner cannot guess "subjectivity" from the word.

## Findings
(record here; also log `../findings.md` — historical anchor `F-A-15`)
