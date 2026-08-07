# dashboard-corpus-pulse — the dashboard's numbers must be REAL, not drawn

- **Module:** The admin dashboard's at-a-glance numbers. Every tile and every graph traces to real data, or says it has none. A constant dressed as a measurement is the defect this module exists to catch.
- **Surface:** `/admin/dashboard`, and the pulse rail in the admin sidebar.
- **Real dep:** A corpus you can add to, so the numbers have something to move with.
- **Backing e2e:** `dashboard-corpus-pulse.spec.ts` · `admin-system-pulse.spec.ts`.

## Checks

### 1 — The pulse follows the real corpus ⭐
- **Steps:** Read the pulse shape and today's point. Add several raw entries. Reload. Read them again.
- **Expected:** Today's point rises with the writes. On an instance with no corpus the pulse is flat or empty. The same curve appearing on two different instances is the failure.
- **Backing test:** `dashboard-corpus-pulse.spec.ts`

### 2 — Every number on the card is computed, not typed
- **Steps:** Read each figure in the jobs card and each KPI tile. For each one, change the state it claims to describe. Reload. Read it again.
- **Expected:** Each figure moves with its own state. A zero is legitimate only when the underlying state is genuinely zero, and it says what to do about it.
- **Backing test:** `admin-dashboard.spec.ts`

### 3 — A graph can be read, not just seen
- **Steps:** Look at the sparkline. Find the axis. Hover a point.
- **Expected:** The axis states its scale. Hovering a point names the date and the count. The caption says what the series plots, so a daily delta is not read as a total.
- **Backing test:** `admin-system-pulse.spec.ts`

### 4 — Every value the panel renders is actually visible
- **Steps:** On an ordinary window, screenshot the pulse rail and the cards. Compare what the DOM holds against what the box shows.
- **Expected:** Nothing is clipped. A value present in the DOM but outside its box is unreachable to the owner, and reading text alone cannot tell the two apart.
- **Backing test:** `admin-system-pulse.spec.ts` (geometry)

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

A number or a graph that would look identical on someone else's instance is painted, not measured.
The tell for the whole fabricated-data class: it does not move when the thing it claims to measure moves.
Read the layout as well as the text — a value squeezed out of its box is as absent as one never fetched.
