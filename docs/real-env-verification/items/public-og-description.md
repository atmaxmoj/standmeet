# public-og-description — the public root's meta description must be the owner's

- **Module:** Public-page SEO metadata. The site root's `<meta name="description">` and og:description trace to the owner's real page content. The owner-facing copy names the field that actually feeds it.
- **Surface:** `/` (view source, `<head>`) and `/admin/seo` (the og:description block, testid `seo-description`).
- **Real dep:** none. The owner's own `hero_prose` is the input.
- **Backing e2e:** `public-og-description.spec.ts`.

## Checks

### 1 — The root's meta description reflects the owner's prose ⭐
- **Steps:** Sign in. Open `/admin/page`. Change the hero prose to a distinctive sentence. Save it. Open `/` and view source. Read `<meta name="description" content="…">`.
- **Expected:** The content reflects the sentence you just saved. It is not a string that would ship identically on every instance.
- **Backing test:** `public-og-description.spec.ts`
- **Note:** The sibling landings already do this — `wiki/[...path]` and `output/[...path]` each build `description` from the entry's real content. Read them for the pattern the root must match.

### 2 — The SEO surface names a field that exists
- **Steps:** Open `/admin/seo`. Read the helper copy under the og:description block. Follow its edit link. Look for the field the copy named.
- **Expected:** The copy names the real editable field, and that field exists on the page it links to. Editing that field changes the public description.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

A meta description that is byte-identical on two different owners' instances is a shipped-in constant, not a description.
Same tell as the rest of the fabricated-data class: it does not move when the thing it claims to describe moves.
An instruction that says "edit it under X" and points at a field the schema does not have is a name that lies.
