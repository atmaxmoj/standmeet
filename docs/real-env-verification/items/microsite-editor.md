# microsite-editor — the owner writes a page and watches it become the page

- **Module:** Each microsite has its own editor route: a source pane, a rendered pane, and a layout control between them. The render follows what the owner types without being asked to. A page can be renamed, and the reserved homepage is reachable as itself rather than as one row among the others.
- **Surface:** `/admin/microsites` (the list, the homepage's own card, the rename control) and each page's editor route.
- **Real dep:** The prod stack with its microsite builder, which compiles the owner's source. The homepage is only a stored page once the owner has built one; an untouched instance serves the default from code (see [[microsites]]).
- **Exclusive:** none
- **Backing e2e:** `microsite-editor-entry` · `microsite-editor-live-follow` · `microsite-editor-view-toggle` · `microsite-rename` · `microsite-admin-authoring` · `microsite-preview-before-publish` · `microsite-preview-follows-the-agent` · `microsite-design-system`.

## Checks

### 1 — The render follows typing, with nothing to click ⭐
- **Steps:** Open a page's editor. Type a distinctive sentence into the source. Wait, touching nothing else.
- **Expected:** The rendered pane shows that sentence on its own — no build button pressed, no reload.
- **Mock gap:** The compile is a real build in the builder container; a stubbed builder makes the wait meaningless.
- **Backing test:** `microsite-editor-live-follow.spec.ts`

### 2 — The layout control has three positions and keeps both panes' state
- **Steps:** From the split view, switch to source-only, then to render-only, then back to split. Note where the source was scrolled before switching.
- **Expected:** Each position shows what it names. Returning to split finds the source where it was left rather than reset to the top.
- **Backing test:** `microsite-editor-view-toggle.spec.ts`

### 3 — Opening the editor leaves a preview to look at
- **Steps:** Open a page that has never been previewed.
- **Expected:** A render appears without the owner asking for one. It is this page's content, not another page's.
- **Backing test:** `microsite-editor-entry.spec.ts`

### 4 — Renaming a page moves its address and nothing else ⭐
- **Steps:** Rename a page's slug from the editor header. Open the live page at the new address, then at the old one.
- **Expected:** The new address serves the page with its content intact. The old address no longer serves it.
- **Backing test:** `microsite-rename.spec.ts`

### 5 — The preview is not the live page
- **Steps:** Edit a live page's source and let the preview follow. Open the live address in another tab without publishing.
- **Expected:** The live address still serves the previous build. The change reaches it only when the owner publishes.
- **Backing test:** `microsite-preview-before-publish.spec.ts`

### 6 — A page written through MCP shows the same way
- **Steps:** Write to the same page through the owner's MCP client while its editor is open.
- **Expected:** The editor's render follows that change too, by the same route as a typed one.
- **Backing test:** `microsite-preview-follows-the-agent.spec.ts`

### 7 — The design system reaches a built page
- **Steps:** Open a built page that uses the SDK widgets and read its typography and colours against the admin's.
- **Expected:** The serif body, the mono labels and the palette are the product's, not a browser default. A widget's own layout holds without the owner having compiled a class for it.
- **Backing test:** `microsite-design-system.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The editor's own labels are claims: a control called "auto" must not need a click, and a pane called "preview" must not be showing the published page.

The source pane, the rendered pane and the live page are three views of one document — say which of the three disagrees, and about what.

Every control in the editor header must act: a gear with a position that changes nothing, a rename field that does not rename, and a link to the live page that opens the wrong page are each a dead affordance.
