# public-og-description — the public root's meta description must be the owner's, not a fixed string

- **Status:** ⬜ not started (new round)
- **The real field:** the owner's public description **should** derive from `hero_prose` — the prose the
  owner edits under `/admin/page` (testid `hero-prose`) and the very text the public root already renders
  (via `Hero` in `page-shell.tsx`). The sibling landing pages already do the honest thing:
  `wiki/[...path]/page.tsx` and `output/[...path]/page.tsx` each have a `generateMetadata` that builds
  `description` from the entry's real content (`excerpt || body.slice(0,160)`). The root page is the one
  surface that skips it and paints a constant instead.
- **Module:** public-page SEO metadata. The site-root `<meta name="description">` / og:description must
  trace to the owner's real page content — never a shipped-in constant, and never an owner instruction
  that points at a non-existent field.
- **Surface:** `/` (view-source / `<head>`), and `/admin/seo` (the misleading "Uses your page tagline" copy).
- **Backing e2e:** `public-og-description.spec.ts` (RED→GREEN: edit hero_prose in `/admin/page`, load `/`,
  the meta description must reflect the edited prose, not `'A personal page that argues back.'`).

## Checks

### 1 — the public root's meta description reflects the owner's prose ⭐
- **Steps:** sign in to `/admin/page`; change the hero prose to a distinctive sentence (e.g.
  "I turn quiet obsessions into shipped systems.") and save. Open the public root `/` and **view source**
  (or inspect `<head>`); read `<meta name="description" content="…">`.
- **Expected:** the `content` reflects the edited hero prose. It must **NOT** be
  `A personal page that argues back.` — the string that ships identical on every instance.
- **⚠️ the bug this came from:** the root description is a static constant in `layout.tsx` and the root page
  has no `generateMetadata`; editing the page never changes it. Fix: give the root a `generateMetadata`
  that derives `description` from `hero_prose` (mirror the wiki/output landing pattern).
- **Result:** ⬜
### 2 — the SEO surface points the owner at a field that exists
- **Steps:** `/admin/seo` → the og:description block (testid `seo-description`). Read its helper copy and
  follow its edit link.
- **Expected:** it names the **real** editable field (hero prose, under `/admin/page`) and editing that
  field actually changes the public description. (Currently it says "Uses your page tagline." → `/admin/page`,
  but no page `tagline` field exists and the description wouldn't move anyway. Fix the copy when check 1's
  fix lands so the two agree.)
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity
A meta description that is byte-identical across two different owners' instances is a shipped-in constant,
not the owner's page. Same tell as the whole fabricated-data class: **it doesn't move when the thing it
claims to describe moves.** And an owner instruction ("edit it under X") that points at a field the schema
doesn't have is a name that lies — the copy asserts an edit path that leads nowhere.

## Findings
- **rot-C3** — the public root `<meta name="description">` is the hardcoded `A personal page that argues
  back.` (constant in `layout.tsx`; root `page.tsx` has no `generateMetadata`), while `/admin/seo` sends the
  owner to a non-existent page `tagline` field to change it. Real field is `hero_prose`; the honest fix is a
  root `generateMetadata` deriving the description from it (as wiki/output landings already do).
