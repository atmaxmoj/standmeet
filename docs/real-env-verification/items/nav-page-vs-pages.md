# nav-page-vs-pages — the sidebar's two "page(s)" entries must be distinguishable

- **Module:** The admin left-nav. Every nav label names the surface it opens. No two labels are trivially confusable.
- **Surface:** `/admin` — the sidebar, present on every admin page. The labels are plain strings in `AdminSidebar.tsx`, not i18n keys.
- **Real dep:** none.
- **Backing e2e:** `nav-page-vs-pages.spec.ts`.

## Checks

### 1 — The two nav entries carry distinct, non-confusable labels ⭐
- **Steps:** Open `/admin`. Read the sidebar cold, as a first-time owner. Find the entry under `settings` that opens the single public page editor. Find the entry under `corpus` that opens the microsites list.
- **Expected:** The two labels differ by a word that names the difference, such as `landing page` against `microsites`. Neither label is bare `page` or `pages`. A first-time owner tells them apart without clicking either one.
- **Backing test:** `nav-page-vs-pages.spec.ts`

### 2 — Each entry lands on the surface its label names
- **Steps:** Click the `settings` entry. Read the route and the section. Go back. Click the `corpus` entry. Read the route and the section.
- **Expected:** The `settings` entry opens `/admin/page`, the single landing-page editor. The `corpus` entry opens `/admin/microsites`, the microsites list with its `/p/{slug}` items. Each destination matches the noun in its label.
- **Backing test:** `nav-page-vs-pages.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Read the whole nav cold, before you click anything.
Any two rows whose labels differ only by a plural or a dropped adjective are the tell.
A label that does not say which of two similar things it opens is not a label.
If you would have to click both rows to learn the difference, the names have failed.
