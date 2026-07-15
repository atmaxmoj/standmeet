# admin-shell — Admin shell + dashboard: nav, badges, KPIs cross-view

- **Status:** 🟩 F-C-1 fixed — re-verify badges + every KPI-vs-list
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
- **Result:** 🟩 green

### 2 — Every KPI reconciles with its list ⭐  (cross-view consistency)
- **Steps:** for **every** dashboard KPI / badge (codes-live, corpus counts, requests, …), find the list/table it summarizes and confirm they **AGREE**.
- **Expected:** no count that can't be reconciled to a list. This is the F-C-1 / F-D-1 / F-L-4 family — two views of one dataset disagreeing, which no single-screen check catches.
- **⚠️ known instances:** F-L-4 (dashboard corpus **count** diverged from the list — fixed by sourcing `COUNT(*)`); F-D-1 (codes-live KPI 3 vs empty list — [[access-codes]], the mirror image, still open).
- **Backing test:** `admin-obsidian.spec.ts` (vault stats) + growth-stats. No spec cross-checks every KPI against its list (gap) — the cross-view lens is manual (SOP §1b).
- **Result:** ⬜ (sweep every KPI this round)

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The shell loads with no console error; **every count/badge/KPI agrees with the list it summarizes** (this module IS the cross-view-consistency home); no empty section that should have content.

## Findings
(record here; also log `../findings.md`, ID `F-C-1` historical anchor)

- **F-C-1 ✅fixed** — admin-load ZodError + triple-broken sidebar badges (wrong paths / bare-array schema / missing `rawListItem.status`). Strict positive guard, RED→GREEN proven.
- **Class note:** F-L-4 (fixed) and F-D-1 (open) are the same count-vs-list family — sweep-the-class every round (SOP §1b lens 2).
