# application-status-persist — a control must not pretend to save

- **Module:** The admin applications detail. Any control that shows a selected state reflects what the instance actually holds. A local toggle dressed as a saved edit is the defect this module exists to catch.
- **Surface:** `/admin/applications` → open an application → the status control.
- **Real dep:** At least one committed application, which comes from the job loop (see [[application-commit]]).
- **Backing e2e:** `application-status-persist.spec.ts`.

## Checks

### 1 — A reload never contradicts what the control showed ⭐
- **Steps:** Open an application. Note the active status. Click a different one. Close the modal. Reload the page. Reopen the same application.
- **Expected:** What the control shows after the click equals what it shows after the reload. Two shapes satisfy this: the click persisted, or the control never moved because it does not commit. The failing shape is a control that moves on click and reverts on reload, because that asserts a status the instance never stored.
- **Note:** Whether a status is editable at all is a product question. Today the applications route is read-only and the backend's status vocabulary is a machine lifecycle, not a recruiter-response set, so there is nowhere coherent to persist a reply state. A read-only control is a legitimate answer to this check.
- **Backing test:** `application-status-persist.spec.ts`

### 2 — The active status is readable without relying on styling
- **Steps:** Read which status the control marks as active, using a stable marker rather than a CSS class.
- **Expected:** The active status is exposed in a way a guard can assert. A guard that reads a class name breaks the moment the styling changes, and then stops covering this.
- **Backing test:** `application-status-persist.spec.ts`

### 3 — Every other control in the modal saves or does not claim to
- **Steps:** Interact with each remaining control in the detail modal. Reload after each. Compare.
- **Expected:** Anything that appears to accept an edit either survives the reload or is visibly non-committing.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Do the owner's action by hand, then reload. If what you set is gone, the control lied about saving.
No compiler and no type checker will ever catch that — only the reload does.
A control that cannot save should not look like one that can.
