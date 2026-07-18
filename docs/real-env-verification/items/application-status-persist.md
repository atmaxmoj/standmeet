# application-status-persist — the status control must not pretend to save

- **Status:** ⬜ not started (new round)
- **Why it can't save today:** the backend `/applications` route is **GET-only**
  (`backend/internal/plugins/jobs/jobsadmin/routes.go` ~L59 — `r.Get("/", listApplications)`); the
  package header says all writes go through MCP `applications.commit`, and there is **no** status-write
  endpoint or MCP tool. The stale modal comment (~L5 "status PATCH 走后端的 applications endpoint")
  describes a REST path that does not exist. The canonical design itself
  (`docs/design/project/admin.js` `ApplicationDetailModal`) wires the segmented as
  `onChange={()=>{}}` — a **no-op**: it was only ever meant to *display* the current status, never to
  write. And the backend `status` column is a machine lifecycle
  (`pending → submitted → failed/withdrawn`, `backend/internal/domain/application.go`), a different
  vocabulary from the modal's recruiter-response set — `parseAppStatus` maps every real committed row
  to the `silent` fallback. There is nowhere coherent to persist `replied`/`offer` today.
- **Module:** the admin applications detail. Any control that shows `is-on`/selected state must reflect
  what the instance actually holds — never a local toggle dressed as a saved edit.
- **Surface:** `/admin/applications` → open an application → the `status` segmented.
- **Backing e2e:** `application-status-persist.spec.ts` (RED→GREEN: the status shown after an owner
  interaction must equal the status shown after a reload — the UI must not claim a status a reload
  contradicts).

## Checks

### 1 — the status control must not claim a status that a reload contradicts ⭐
- **Steps:** on a fresh instance seed one application (MCP `applications.commit`). Open
  `/admin/applications` → open the application → note the active status segment. Click a **different**
  segment (e.g. `offer`). Close the modal, **reload** the page, reopen the same application.
- **Expected (honest — either shape passes):** the status shown right after the click must equal the
  status shown after the reload. Two honest outcomes satisfy this — (a) the click genuinely persisted
  and survives reload, or (b) the control is read-only / non-committing so the click never moved
  `is-on` in the first place. The **only failing** outcome is the current one: the click shows `offer`
  as active (looks saved), the reload shows `silent` (reverted) — the modal asserted a status the
  instance never stored.
- **⚠️ the bug this came from:** `StatusSegmented.onChange → setStatus` is local `useState`; there is
  no persistence path (route is GET-only, design `onChange` is a no-op). The owner changes a status,
  it looks saved, a reload silently loses it.
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity
A selected/`is-on` control that flips on click but forgets after a reload is a painted state, not a
saved one. The tell for this whole lying-control class: **do the owner's action by hand, then reload —
if what you set is gone, the control lied about saving.** The lint/tsc/build never will.

## Findings
- **rot-C1 (MEDIUM)** — the application `status` segmented moves `is-on` on click via local `useState`
  with no persistence (GET-only route, design `onChange={()=>{}}`, and a backend `status` vocabulary
  that the modal's set doesn't even map to). Honest fix (chosen interpretation = **make-honest**, not
  build a persist path): make the control non-committing / read-only so it stops asserting an unsaved
  edit — or, if a real owner-editable CRM-status field is later added, wire it to a persisted endpoint.
  Either way the fix should expose the active status via a stable marker so the guard can read it
  without depending on the `is-on` class.
