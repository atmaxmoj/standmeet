# seo-domain-link — an "edit over there →" link must reach a real editor

- **Module:** The SEO section's cross-links to where a mirrored value is actually edited. Every "edit over there →" link resolves to the real editor for that value.
- **Surface:** `/admin/seo` → the "canonical host" row → its edit link.
- **Real dep:** none.
- **Backing e2e:** `seo-domain-link.spec.ts`.

## Checks

### 1 — The canonical-host edit link lands on a real editor ⭐
- **Steps:** Open `/admin/seo`. Find the "canonical host" row. Click its edit link. Read the route you arrive at. Find the control that changes the canonical host.
- **Expected:** You arrive at the real public-URL editor and the control is there. You do not arrive at a 404.
- **Backing test:** `seo-domain-link.spec.ts`

### 2 — Every other cross-link on this surface resolves
- **Steps:** Read every "edit …→" link on `/admin/seo`. Click each one. Read each destination.
- **Expected:** Every link opens a page that holds the editor for the value it names.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Click every cross-link by hand.
A route name reads plausibly and still points nowhere, because a compiler happily compiles a string.
A link whose path is absent from `app/admin/` is a 404 waiting for the owner to find it.
