# seo-domain-link — the "edit on the Domain section" link must reach a real editor

- **Status:** ⬜ not started (new round)
- **Module:** the SEO section's cross-links to where a mirrored value is actually edited. Every "edit
  over there →" link must resolve to the real editor for that value, not a route that doesn't exist.
- **Surface:** `/admin/seo` → "canonical host" → the "edit on the Domain section →" link.
- **Backing e2e:** `seo-domain-link.spec.ts` (RED→GREEN: following the link must land on a real page
  editor surface — `public-url-display` visible / `**/admin/page` — not a 404).

## Checks

### 1 — the canonical-host edit link lands on a real editor ⭐
- **Steps:** open `/admin/seo`; under "canonical host" click "edit on the Domain section →".
- **Expected:** you arrive at the real public-URL / domain editor (`/admin/page`, `public-url-display`
  visible), where the canonical host can actually be changed.
- **⚠️ the bug this came from:** the link hard-coded `/admin/domain`, a route that was never built. The
  domain/public-URL editor lives under `/admin/page`. So the link 404s and the owner can't reach the
  thing the SEO section tells them to edit.
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity
A link whose href names a route that isn't in `app/admin/` is a **404 waiting to be clicked**. The tell
for this class: the target reads plausibly ("/admin/domain") but grepping the routes shows no such dir.
Click every "edit over there →" by hand — tsc/build happily compile a string that points nowhere.

## Findings
- **rot-C2** — `seo-canonical-edit` linked to `/admin/domain`, a non-existent route; the real editor is
  at `/admin/page` (`public-url-display` / `public-url-editor`).
