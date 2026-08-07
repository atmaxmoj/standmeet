# admin-shell — Admin shell + dashboard: nav, badges, KPIs cross-view

- **Module:** The admin shell loads clean, the sidebar badges show real counts, and every figure on the dashboard reconciles with the list it summarizes. This module is the home of the cross-view-consistency lens: two views of one dataset must not disagree.
- **Surface:** The admin shell — nav, sidebar, top bar — and `/admin/dashboard`.
- **Real dep:** A claimed owner with enough corpus, codes and requests that the counts are non-trivial.
- **Backing e2e:** `admin-sidebar` · `admin-dashboard` · `admin-system-pulse` · `admin-login-landing` · `admin-obsidian`.

## Checks

### 1 — The shell loads with an empty console
- **Steps:** Load each admin section in turn. Watch the console, including unhandled promise rejections.
- **Expected:** No errors anywhere. A schema mismatch that throws as an unhandled rejection is invisible to a listener watching console events, so read both.
- **Backing test:** `admin-sidebar.spec.ts`

### 2 — Every badge shows a real count
- **Steps:** Read each sidebar badge. Find the list each one summarizes. Compare.
- **Expected:** Each badge equals its list. A badge that renders zero while its list is populated, or renders at all while its list is empty, is the defect.
- **Backing test:** `admin-sidebar.spec.ts`

### 3 — Every dashboard figure reconciles with its list ⭐
- **Steps:** For each KPI and each figure on the dashboard, open the list it summarizes and compare. Then mutate the underlying data and compare again without reloading.
- **Expected:** No figure that cannot be reconciled to a list, at rest and immediately after a change. This family has produced defects in both directions — a count that was right beside an empty list, and a list that was right beside a stale count.
- **Mock gap:** No spec cross-checks every figure against its list. The lens is manual by design.
- **Backing test:** `admin-dashboard.spec.ts` (some figures) · the sweep → `gap`

### 4 — The version badge equals the version the process reports ⭐
- **Steps:** Read the version on the login page. Sign in and read the top-bar badge. Open the system section and read the deployment version.
- **Expected:** All three state the same version, and it is the one the running process reports. No badge carries an environment label it does not track.
- **Backing test:** `admin-login-landing.spec.ts`

### 5 — Every value the shell renders is actually visible
- **Steps:** On an ordinary window height, look at the sidebar rail and the footer. Compare what they hold against what fits.
- **Expected:** Nothing is clipped out of its box. A value present in the DOM but outside its container is unreachable, and no text assertion can tell the difference.
- **Backing test:** `admin-system-pulse.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Sweep the class, not the instance: when one count disagrees with one list, check every other count on the product the same way.
No section is empty where content exists, and no section claims content where none does.
Read the shell's own labels — instance, version, uptime — and ask what each one tracks; a label that would read identically on someone else's deployment tracks nothing.
