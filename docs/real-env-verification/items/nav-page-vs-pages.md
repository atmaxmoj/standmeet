# nav-page-vs-pages — the sidebar's two "page(s)" entries must be distinguishable

- **Status:** ⬜ not started (new round)
- **Fix:** rename to disambiguate. Proposed: **"landing page"** for slug `page` (the single public page)
  and **"custom pages"** for slug `custom-pages` (the microsites). The distinguishing tokens become
  `landing` vs `custom` — neither is bare "page"/"pages". Labels are plain strings in
  `app/src/components/admin/AdminSidebar.tsx` (lines 42 and 78), not i18n keys yet.
- **Module:** the admin left-nav. Every nav label must name the surface it opens; no two labels may be
  trivially confusable.
- **Surface:** `/admin` (the sidebar, present on every admin page).
- **Backing e2e:** `nav-page-vs-pages.spec.ts` (RED→GREEN: the `page` nav says "landing …", the
  `custom-pages` nav says "custom …"; RED on today's "public page" / "pages").

## Checks

### 1 — the two nav entries have distinct, non-confusable labels ⭐
- **Steps:** open `/admin`; read the sidebar. Find the entry in `settings` that opens the single public
  page editor, and the entry in `corpus` that opens the microsites list.
- **Expected:** their labels are unmistakably different — e.g. "landing page" vs "custom pages". Neither
  is just "page" or "pages"; a first-time owner can tell which opens the one landing page and which
  opens the microsite collection without clicking.
- **⚠️ the bug this came from:** the two labels were "public page" (settings) and "pages" (corpus) —
  two words apart, semantically the same phrase, for two unrelated surfaces.
- **Result:** ⬜
### 2 — clicking each entry lands on the right surface
- **Steps:** click the `settings` entry → confirm it opens the single landing-page editor
  (`/admin/page`, PageSection). Click the `corpus` entry → confirm it opens the microsites list
  (`/admin/custom-pages`, CustomPagesSection with `/p/{slug}` items).
- **Expected:** each label's destination matches the noun it now uses (landing page vs custom pages).
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity
Two sidebar rows whose labels differ only by "public "/nothing and "page"/"pages" are the tell: a label
that doesn't say which of two similar things it opens is not a label. Read the nav cold, as a first-time
owner — if you'd have to click both to learn the difference, the names have failed.

## Findings
- **rot-D2** — `page` → "public page" and `custom-pages` → "pages" were two confusable labels for the
  landing page vs the microsites. Fix: rename to "landing page" / "custom pages".
