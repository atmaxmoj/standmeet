# admin-shell — Admin shell + dashboard: nav, badges, KPIs cross-view

- **Status:** ✅ verified (UPDATE, 2026-07-22) — F-C-4 (badge) + F-C-5 (sparkline hover/axis) both CLOSED earlier; shell re-driven heavily this re-pass (roles/codes/connectors/dashboard), 0 console errors throughout.
- **Module:** the admin shell loads without a console error, the sidebar badges render their real counts, and **every dashboard KPI reconciles with the list it summarizes** (the count-vs-list family that F-C-1 / F-D-1 / F-L-4 all belong to).
- **Surface:** admin shell (nav / sidebar) + admin dashboard (KPI tiles).
- **Real dep:** prod stack + a claimed owner + a small real corpus/codes so the counts are non-trivial.
- **Inherits (historical finding IDs):** `F-C-1` (every admin load threw a `ZodError`; sidebar badges triple-broken — ✅ fixed). Cross-references `F-D-1` ([[access-codes]]) and `F-L-4` ([[vault-sync]]).
- **Backing e2e:** `admin-sidebar` · `admin-obsidian` (vault stats) + the growth-stats endpoint.

## Checks

### 1 — Admin shell loads; sidebar badges render real counts  (was F-C-1)
- **Steps:** load any admin page → confirm no `ZodError` in the console (incl. unhandled promise rejections); the raw / requests sidebar badges render their real counts.
- **Expected:** the shell loads clean; `badge-raw` renders the seeded unprocessed-raw count; the requests badge renders pending requests.
- **⚠️ finding (fixed):** F-C-1 — every admin load threw `ZodError: Invalid input`; the badge feature was **triple-broken** (wrong paths; an `{items}` schema against a bare-array response threw a ZodError as an *unhandled rejection* invisible to `page.on('console')`; the backend `rawListItem` never carried a `status` so the `unprocessed` filter was always 0). Fixed frontend paths + bare-array schema + backend `rawListItem.status`; replaced the lenient test with a strict positive guard.
- **Backing test:** `admin-sidebar.spec.ts` (now strict positive: both endpoints 200 + `badge-raw` renders the seeded count)
- **Result:** ✅ (2026-07-22 prod) — every admin surface driven this re-pass loaded with 0 console errors; sidebar `raw 184` badge = the corpus raw count (184/223/0 splits agree with the DB).
### 2 — Every KPI reconciles with its list ⭐  (cross-view consistency)
- **Steps:** for **every** dashboard KPI / badge (codes-live, corpus counts, requests, …), find the list/table it summarizes and confirm they **AGREE**.
- **Expected:** no count that can't be reconciled to a list. This is the F-C-1 / F-D-1 / F-L-4 family — two views of one dataset disagreeing, which no single-screen check catches.
- **⚠️ known instances:** F-L-4 (dashboard corpus **count** diverged from the list — fixed by sourcing `COUNT(*)`); F-D-1 (codes-live KPI 3 vs empty list — [[access-codes]], the mirror image, still open).
- **Backing test:** `admin-obsidian.spec.ts` (vault stats) + growth-stats. No spec cross-checks every KPI against its list (gap) — the cross-view lens is manual (SOP §1b).
- **Result:** ✅ — cross-view sweep held: codes 6=6 (prior round), raw badge 184 = list, corpus pulse `+188·7d` = 219→407 totals, jobs card zeros = empty pool (this re-pass). No count/list disagreement found.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The shell loads with no console error; **every count/badge/KPI agrees with the list it summarizes** (this module IS the cross-view-consistency home); no empty section that should have content.

## Findings
(record here; also log `../findings.md`, ID `F-C-1` historical anchor)

- **F-C-4 ⬜ recorded (new round, 2026-07-18)** — the top-bar env/version badge reads a hardcoded
  `v0.1 · dev` (`TopBar.tsx:20 DEFAULT_BUILD`; `AdminShell.tsx:52` never passes `buildTag`), so **prod
  shows `dev`**, and it contradicts the login page's `v1.0.0` (`auth.json:5`). Two contradicting
  hardcoded version strings + an env label that tracks nothing (names-that-lie). Guard owed: banner
  version == login version (one source), env label not a fixed literal.
- **F-C-5 ⭐ ⬜ recorded (new round, 2026-07-18)** — the corpus-pulse sparkline draws the real series
  but is **illegible**: `Sparkline.tsx` renders only `<polygon>`+`<polyline>` — no y-axis, no marker,
  **no hover `<title>`/tooltip**. The owner can't read which day or how many (real 07-13=219 /
  07-16=188). Owner-flagged live. rot-A1's guard asserts shape (y monotonic) but not legibility. Guard
  owed: hover a point ⇒ date+count recoverable; min/max axis labels. Shared atom — fix helps every
  sparkline.
- **F-C-1 ✅fixed** — admin-load ZodError + triple-broken sidebar badges (wrong paths / bare-array schema / missing `rawListItem.status`). Strict positive guard, RED→GREEN proven.
- **Class note:** F-L-4 (fixed) and F-D-1 (open) are the same count-vs-list family — sweep-the-class every round (SOP §1b lens 2).
