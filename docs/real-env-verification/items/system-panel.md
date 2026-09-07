# system-panel — the instance reports its own health, from its own measurements

- **Module:** The system section shows what this deployment is doing right now: the resources its containers hold, the background jobs and when each next runs, and the state of the services it depends on. The numbers come from the instance measuring itself, not from a host it may not be allowed to ask.
- **Surface:** `/admin/system` — the resources panel, the cluster panel and the background-jobs list.
- **Real dep:** The prod stack running under its normal container limits. A host where the docker socket is not handed to the backend, so the reading has to come from the container's own accounting.
- **Exclusive:** none
- **Backing e2e:** `admin-system` · `admin-system-pulse` · `admin-system-jobs`.

## Checks

### 1 — The resource numbers are this instance's, and they move ⭐
- **Steps:** Read disk, memory and load. Put the instance under a load that shows — import a vault, render a document. Read them again without reloading the page.
- **Expected:** The figures change while the page stays open. Disk used and disk total are consistent with each other rather than two unrelated readings.
- **Mock gap:** The values come from the container's own accounting on a real host; a fixture supplies whatever it was told to.
- **Backing test:** `admin-system.spec.ts` · `admin-system-pulse.spec.ts`

### 2 — Live refresh does not blank the panel ⭐
- **Steps:** Watch the resources and cluster panels for a minute without touching anything.
- **Expected:** Values update in place. No skeleton flash, no panel emptying and refilling between ticks.
- **Backing test:** `admin-system-pulse.spec.ts`

### 3 — Every background job is listed with a real schedule
- **Steps:** Read the jobs list. Compare each entry against the schedule the instance actually runs it on.
- **Expected:** Each job names its interval, and the interval is derived rather than typed into the page. A job that runs is listed; one that is listed runs.
- **Backing test:** `admin-system-jobs.spec.ts`

### 4 — Nothing on the panel is a permanent placeholder
- **Steps:** Read every labelled slot on the section, including the shell's footer.
- **Expected:** Each holds a value that came from somewhere. A label whose value would read the same on any other deployment is naming nothing.
- **Backing test:** `admin-system.spec.ts`

### 5 — A dependency that is down is reported as down
- **Steps:** Stop one service the instance depends on. Read the panel.
- **Expected:** It says which one, in words the owner can act on. The rest of the panel keeps working rather than failing whole.
- **Mock gap:** Requires actually stopping a service in the running stack; a fixture cannot produce the partial state.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Every figure here is a claim about this machine: ask of each one what it would read on somebody else's deployment, and name any that would read the same.

The resources panel and the containers actually running are two views of one stack — a number that does not move while the instance is clearly working is the finding.

Every control on the section must act: a refresh that does not refresh, and a panel that offers a detail view onto nothing, are dead affordances on the screen an owner opens when something is already wrong.
