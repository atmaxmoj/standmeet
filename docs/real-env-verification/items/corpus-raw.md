# corpus-raw — Corpus: raw inbox ingest + clean excerpts

- **Module:** The owner's raw inbox. MCP `raw_dump` lands a note. The note lists in admin/raw with a clean rendered excerpt, not raw markup. `promote_to_wiki` moves it to wiki. Every count of the inbox agrees with the list.
- **Surface:** `/admin/raw`, plus owner MCP (`raw_dump` / `promote_to_wiki`).
- **Real dep:** The real vault's raw notes, and a real MCP client (see [[owner-mcp]]).
- **Backing e2e:** `sync-i-raw` · `sync-k-raw-tree` · `integration-corpus-pipeline` · `owner-mcp-parity-mutations` · `admin-raw-crud`. Excerpt cleanliness against markup-heavy bodies → `gap`.

## Checks

### 1 — A raw excerpt derives from rendered text, not from markup ⭐
- **Steps:** Open `/admin/raw`. Find a note whose body opens with a mermaid fence, a display-math block, a `[[wikilink]]`, or a `- ` bullet. Read that card's excerpt.
- **Expected:** The excerpt contains no `$$`, no ``` ``` ``` fence, and no `[[`. It does not end mid-token. Fences, math, wikilink brackets and list markers are stripped before truncation.
- **Mock gap:** No spec builds a markup-heavy body and asserts the excerpt is clean.
- **Backing test:** `gap`.

### 2 — A raw dump lands, lists, and promotes
- **Steps:** Call `raw_dump` through a real MCP client. Open `/admin/raw` and find the note. Call `promote_to_wiki` on it. Retrieve it from wiki.
- **Expected:** The note persists, lists, and promotes. Raw stays owner-only until promotion.
- **Backing test:** `integration-corpus-pipeline.spec.ts` · `owner-mcp-parity-mutations.spec.ts`

### 3 — Delete means delete, and the button says so ⭐
- **Steps:** Pick a raw row. Attach an image to it (see [[corpus-media]] check 9). Note the section count and the sidebar `badge-raw`. Click the row's delete button. Read the confirm dialog before you accept. Accept it. Reload the whole page. Open the image's object URL again.
- **Expected:** The button reads `delete`, never `archive`. The confirm says "This cannot be undone". The row is gone, and stays gone after the reload. No `archived` tab exists in the filter row. The image's object URL no longer resolves, so the file left the bucket.
- **Mock gap:** `tool-corpus-mutations.spec.ts` covers the API layer only. Button wording and confirm copy have no spec — no assertion covers a word.
- **Backing test:** `tool-corpus-mutations.spec.ts` (API layer) · `admin-raw-crud.spec.ts` (the counters move)

### 4 — A mutation moves every counter, without a reload
- **Steps:** Note the section header count, the four tab counts, the sidebar `badge-raw`, and the pulse rail. Dump one note. Read all four again. Delete one row. Read all four again. Do not reload at any point.
- **Expected:** The dump raises all four counts by one. The delete lowers all four by one. The list length and every counter agree at every moment.
- **Backing test:** `admin-raw-crud.spec.ts` ("deleting a raw entry moves the counters")

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The list is non-empty when raw exists, and every excerpt reads as prose, not as source.
The header count, the tab counts and the sidebar badge all state the same number as the list length.
Every affordance fires: import, export, promote, edit, delete.
The delete button's verb matches what it does.
No tab exists whose backing query does not exist.
