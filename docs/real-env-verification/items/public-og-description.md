# public-og-description — the public root's meta description must be the owner's

- **Module:** Public-page SEO metadata. Each microsite carries its own title and description, injected into the head the instance serves for it, together with the share-card tags a link needs when it is pasted somewhere. There is no instance-wide SEO setting: what a page says about itself is set on that page.
- **Surface:** `/` (view source, `<head>`).
- **Real dep:** none. The owner's own `hero_prose` is the input.
- **Exclusive:** none
- **Backing e2e:** `public-og-description` · `microsite-per-page-seo`. Whether a live microsite reaches the sitemap → `gap`.

## Checks

### 1 — The root's meta description reflects the owner's prose ⭐
- **Steps:** Sign in. Open `/admin/page`. Change the hero prose to a distinctive sentence. Save it. Open `/` and view source. Read `<meta name="description" content="…">`.
- **Expected:** The content reflects the sentence you just saved. It is not a string that would ship identically on every instance.
- **Backing test:** `public-og-description.spec.ts`
- **Note:** The sibling landings already do this — `wiki/[...path]` and `output/[...path]` each build `description` from the entry's real content. Read them for the pattern the root must match.

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

A meta description that is byte-identical on two different owners' instances is a shipped-in constant, not a description.
Same tell as the rest of the fabricated-data class: it does not move when the thing it claims to describe moves.

### 4 — Two pages describe themselves differently
- **Steps:** Set a title and description on two microsites. Fetch each page's served head.
- **Expected:** Each head carries its own page's words. Neither falls back to a description belonging to the instance or to the other page.
- **Backing test:** `microsite-per-page-seo.spec.ts`

### 5 — A pasted link renders a share card
- **Steps:** Paste a live microsite's address into a chat client that unfurls links.
- **Expected:** The card shows that page's title and description, not the instance's name alone or a bare URL.
- **Mock gap:** What a card looks like is decided by the fetcher on the other side; only pasting into a real client shows it.
- **Backing test:** `microsite-per-page-seo.spec.ts`

### 6 — A live page is in the sitemap
- **Steps:** Publish a microsite and fetch the sitemap.
- **Expected:** Its address is listed. A page that is not live is not.
- **Backing test:** `gap`
