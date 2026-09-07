# instance-upgrade — a running instance moves to a newer build without losing what it holds

- **Module:** An instance that has been live for months takes a newer release: the backend brings its own database up to date when it starts, the deploy substrate replaces the containers in place, and the owner is told from the panel what version they are on and whether a newer one exists.
- **Surface:** `/admin/system` — the version and upgrade card. The deploy itself, which is a restart rather than a screen.
- **Real dep:** A database volume with real data that predates the release under test, so the migration has something to move. The image registry the instance checks for newer versions.
- **Exclusive:** none
- **Backing e2e:** `upgrade-embed-schema` · `upgrade-pending-email-columns` · `upgrade-code-entropy-compat` · `upgrade-application-code-unique` · `admin-system-upgrade`.

## Checks

### 1 — A deploy alone brings the schema forward ⭐
- **Steps:** On a database holding real rows, roll one table back to the shape it had before a release. Restart the backend, and do nothing else.
- **Expected:** The missing table or column is there afterwards, and the rows that were already present are unchanged. No SQL is run by hand.
- **Mock gap:** A fresh volume applies the whole schema at once, so it can never show a migration that only the upgrade path runs. The path that breaks is the long-lived volume.
- **Backing test:** `upgrade-embed-schema.spec.ts` · `upgrade-pending-email-columns.spec.ts`

### 2 — Data written by the older build still reads on the newer one ⭐
- **Steps:** Before upgrading, create rows through the surfaces that changed shape — an access code, a committed application. Upgrade. Open each surface.
- **Expected:** Each row is present and usable. A value the old build wrote in an old format is accepted rather than rejected as malformed.
- **Backing test:** `upgrade-code-entropy-compat.spec.ts` · `upgrade-application-code-unique.spec.ts`

### 3 — The panel says which version is running, and it is the one running
- **Steps:** Read the version on the login page, in the top bar, and on the system card. Compare against what the process itself reports.
- **Expected:** All of them state the same version. None carries a label describing an environment it does not track.
- **Backing test:** `admin-system-upgrade.spec.ts`

### 4 — The upgrade control says what it can actually do
- **Steps:** Read the upgrade card on a deployment whose substrate can replace containers, and on one that cannot.
- **Expected:** Where the upgrade can happen, the control offers it. Where it cannot, the card says so instead of offering a button that will do nothing.
- **Mock gap:** Whether the substrate can act is a property of how this instance was deployed; nothing inside the app can be asked.
- **Backing test:** `admin-system-upgrade.spec.ts`

### 5 — Asking whether a newer version exists reaches the registry
- **Steps:** From the panel, ask for an upgrade check on an instance that is behind.
- **Expected:** It names the newer version. On an instance that is current, it says so rather than staying silent.
- **Backing test:** `admin-system-upgrade.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The version is a label that must track something: read it in all three places it appears and say which one is a constant.

The panel's claim about the running build and the containers actually running are two views of one deployment — an upgrade that reports success while the old image is still serving is the defect this module exists for.

Every control on the upgrade card must be reachable in some real deployment: a button that no substrate can satisfy is furniture, and one that acts without saying what it will replace is worse.
