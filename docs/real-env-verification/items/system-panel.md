# system-panel — the instance's own state, in one screen the owner can act from

- **Module:** One walk of the system section. It reports what this deployment is doing from its own measurements, lists every place the owner is signed in and lets any of them be ended, and says which build is running and whether a newer one can be taken.
- **Surface:** `/admin/system` — resources, cluster, background jobs, active sessions, and the version and upgrade card. Sign-out lives in the shell.
- **Real dep:** The prod stack under its normal container limits, on a host where the backend is not handed the docker socket. A second owner login that is not the browser doing the looking. A database volume with real data predating the release under test, so a migration has something to move.
- **Exclusive:** none
- **Note:** Session fixation and cookie scoping have their own specs and nothing a person can look at; they are not checks here. This module is what the owner can see and do on this screen.
- **Backing e2e:** `admin-system` · `admin-system-pulse` · `admin-system-jobs` · `admin-system-upgrade` · `owner-sessions-panel` · `owner-signout-kills-session` · `upgrade-embed-schema` · `upgrade-pending-email-columns` · `upgrade-code-entropy-compat` · `upgrade-application-code-unique`.

## Checks

### 1 — The resource numbers are this instance's, and they move ⭐
- **Steps:** Read disk, memory and load. Put the instance under a load that shows — import a vault, render a document. Read them again without reloading the page.
- **Expected:** The figures change while the page stays open, in place, with no skeleton flash between ticks. Disk used and disk total are consistent with each other rather than two unrelated readings.
- **Mock gap:** The values come from the container's own accounting on a real host; a fixture supplies whatever it was told to.
- **Backing test:** `admin-system.spec.ts` · `admin-system-pulse.spec.ts`

### 2 — Every background job is listed with a real schedule
- **Steps:** Read the jobs list. Compare each entry against the schedule the instance actually runs it on.
- **Expected:** Each job names its interval, and the interval is derived rather than typed into the page. A job that runs is listed; one that is listed runs.
- **Backing test:** `admin-system-jobs.spec.ts`

### 3 — Every live login is listed, and ending one ends it ⭐
- **Steps:** Sign in from a second place. Read the panel from the first: both should appear, with the one doing the looking marked as current. Revoke the other, then make an authenticated request from it.
- **Expected:** The request is refused. The other place is signed out rather than continuing until its own cookie expires, and each row says enough — where from, when last active — for the owner to know which one they are ending.
- **Mock gap:** Whether the token is dead is a fact about the session store; a panel that only drops the row would pass any check made in the panel.
- **Backing test:** `owner-sessions-panel.spec.ts`

### 4 — Signing out ends the session rather than only the cookie
- **Steps:** Capture the session token, sign out through the shell, then replay a request with that token.
- **Expected:** The request is refused. Signing out asks first, and cancelling leaves the session alive.
- **Backing test:** `owner-signout-kills-session.spec.ts`

### 5 — A deploy alone brings the schema forward ⭐
- **Steps:** On a database holding real rows, roll one table back to the shape it had before a release. Restart the backend, and do nothing else. Then open the surfaces that write to that table.
- **Expected:** The missing table or column is there, the rows that were already present are unchanged, and the surfaces work. No SQL is run by hand.
- **Mock gap:** A fresh volume applies the whole schema at once, so it can never show a migration only the upgrade path runs. The path that breaks is the long-lived volume.
- **Backing test:** `upgrade-embed-schema.spec.ts` · `upgrade-pending-email-columns.spec.ts` · `upgrade-code-entropy-compat.spec.ts`

### 6 — The version is the one running, and the upgrade control says what it can do
- **Steps:** Read the version on the login page, in the top bar and on the card, and compare against what the process reports. Ask for an upgrade check. Read the control on a deployment whose substrate can replace containers and on one that cannot.
- **Expected:** All three places state the same version. The check names a newer one when there is one and says so when there is not. Where the upgrade cannot happen, the card says so instead of offering a button that will do nothing.
- **Mock gap:** Whether the substrate can act is a property of how this instance was deployed; nothing inside the app can be asked.
- **Backing test:** `admin-system-upgrade.spec.ts`

### 7 — A dependency that is down is reported as down
- **Steps:** Stop one service the instance depends on. Read the panel.
- **Expected:** It says which one, in words the owner can act on. The rest of the panel keeps working rather than failing whole.
- **Mock gap:** Requires actually stopping a service in the running stack; a fixture cannot produce the partial state.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Every figure here is a claim about this machine, and the version is a label that must track something: ask of each what it would read on somebody else's deployment, and name any that would read the same.

The panel and the stack behind it are two views of one instance — a number that does not move while the instance is clearly working, a session row removed while its token still works, and an upgrade that reports success while the old image is still serving are the same defect on three different rows.

Every control on this screen must act, and this is the screen an owner opens when something is already wrong: a refresh that does not refresh, a revoke that leaves the session alive, and a button no substrate can satisfy are each worse here than anywhere else.
