# page-corpus-pinning — homepage insights/projects = corpus pin windows

- **Module:** The public page's insights and projects sections are ordered pin lists over the corpus, not a second content store. A pinned entry renders its title and excerpt and links into the reader. A thought is stored once. The invariant is that a pinned entry is always a published one, enforced at both write ends.
- **Surface:** Owner MCP (`page.pin` / `page.unpin`) and `/admin/page`'s pin manager, rendering to the public homepage.
- **Real dep:** none external. A real corpus and the publish toggle on the instance.
- **Backing e2e:** `page-corpus-pinning` · `chatroom-layout` · `public-page`. Design: `docs/design/page-corpus-pinning.md`.

## Checks

### 1 — With nothing published, both surfaces say so honestly
- **Steps:** Start with no published wiki entries. Open `/admin/page` and read the pin manager and its picker. Open `/`.
- **Expected:** Each section says it has no pins and that it is hidden on the page. The picker says there is nothing to pin and names publishing as the first step. The homepage renders neither section, header included.
- **Backing test:** `page-corpus-pinning.spec.ts`

### 2 — Publishing makes an entry pinnable, and pinning renders it ⭐
- **Steps:** Publish one wiki entry through the wiki editor, giving it an excerpt. Return to `/admin/page` and open the picker. Pin the entry. Save. Open `/`.
- **Expected:** The entry appears in the picker only after publishing. The homepage section appears with a card carrying the entry's title and excerpt, linking into the reader at its real path.
- **Backing test:** `page-corpus-pinning.spec.ts`

### 3 — Pinning an unpublished entry is refused
- **Steps:** Attempt to pin an unpublished entry, through the MCP tool and through the admin write.
- **Expected:** Both refuse, and the reason names the missing publish.
- **Backing test:** `page-corpus-pinning.spec.ts`

### 4 — Unpublishing a pinned entry unpins it and says so
- **Steps:** Unpublish an entry that is currently pinned. Read the tool's response. Open `/admin/page`. Open `/`.
- **Expected:** The pin is removed. The response declares which sections it touched, so the owner is not surprised later. The homepage drops the card, and hides the section if it is now empty.
- **Backing test:** `page-corpus-pinning.spec.ts`

### 5 — Reordering and unpinning behave
- **Steps:** Pin several entries. Reorder them. Unpin one. Save. Open `/`.
- **Expected:** The homepage order matches the pin order. The unpinned card is gone.
- **Backing test:** `page-corpus-pinning.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

A pinned card links into the real reader — a second copy of the content would mean the thought is stored twice.
An empty section renders nothing at all, header included.
The picker offers only what is publishable, so the invariant is visible in the UI and not just enforced on write.
