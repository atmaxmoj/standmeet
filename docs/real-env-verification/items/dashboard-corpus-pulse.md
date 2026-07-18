# dashboard-corpus-pulse — the dashboard's numbers must be REAL, not drawn

- **Status:** ⬜ not started (new round)
- **Module:** the admin dashboard's at-a-glance numbers. Every tile/graph must trace to real data or
  say it has none — never a constant dressed as a measurement.
- **Surface:** `/admin/dashboard`.
- **Backing e2e:** `dashboard-corpus-pulse.spec.ts` (RED→GREEN: the sparkline geometry must follow the
  real `/stats/growth` series, not a fixed shape).

## Checks

### 1 — the corpus-pulse sparkline reflects real corpus activity ⭐
- **Steps:** on a fresh instance open `/admin/dashboard`; note the pulse shape. Then push several raw
  entries (MCP `raw_dump`, or `/admin/raw`) so today's corpus count rises. Reload the dashboard.
- **Expected:** today's point (the rightmost) rises to reflect the writes; a fresh instance shows a
  flat / empty pulse, NOT the fixed `4,7,2,6,11,…,17` zigzag. The curve must move with the corpus.
- **⚠️ the bug this came from:** the dashboard drew `MOCK_14D` and discarded the real `series` from the
  very endpoint it already calls. The curve was identical on every instance regardless of the corpus.
- **Result:** ⬜
### 2 — the "shortlist" KPI is real, not a painted zero (rot-sweep A3, deferred)
- **Steps:** `/admin/dashboard` → the "jobs · active loop" card → the "shortlist" number.
- **Expected:** it reflects real shortlist state. (Currently a hardcoded `0` styled like the real
  "sent" count next to it — a fabricated-as-fact tile. Fold the fix in when the jobs shortlist has a
  real source.)
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity
A number or graph on this page that never changes between two different instances is a painted
constant, not a measurement. The tell for the whole fabricated-data class: **it doesn't move when the
thing it claims to measure moves.**

## Findings
- **rot-A1** — the corpus-pulse sparkline was `MOCK_14D`; the real series was already fetched and
  thrown away. Fixed: the dashboard now reads `series` from `/stats/growth`.
