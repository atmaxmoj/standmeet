# sandbox — Sandbox: egress isolation, prod driver, cron

- **Module:** Sandboxed skills and tools run isolated. Network egress is gated, the host socket and host filesystem are unreachable, and this holds under the driver prod actually uses. The workspace sweep fires on its own schedule.
- **Surface:** The backend sandbox runtime, and the sandbox panel on `/admin/system` for workspaces (there is no `/admin/sandbox` route — the panel lives inside the system section).
- **Real dep:** The prod stack on its real sandbox driver, plus a reachable payload origin for the egress tests.
- **Backing e2e:** `real-third-party-mcp-network` · `real-third-party-mcp-escape` · `real-third-party-mcp-sandboxed` · `real-third-party-mcp-loader` · `sandbox-workspace-ttl-cron` · `admin-sandbox` · `skill-scripts` · `admin-system-jobs`.

## Checks

### 1 — Granted egress reaches the network; default egress does not ⭐
- **Steps:** Run a sandboxed skill that fetches a reachable payload URL, with network access granted. Then run the identical fetch with no grant.
- **Expected:** The granted run downloads the payload. The ungranted run is denied at the container's network layer, and the denial surfaces as a friendly error rather than a hang or a stack trace.
- **Backing test:** `real-third-party-mcp-network.spec.ts`

### 2 — The sandbox cannot reach the host
- **Steps:** From inside a sandboxed run, try to reach the host container socket. Try to read a host config path.
- **Expected:** Both fail. Neither returns content.
- **Backing test:** `real-third-party-mcp-escape.spec.ts`

### 3 — The isolation holds under the driver prod uses ⭐
- **Steps:** On the prod stack, run a sandboxed script. Confirm where it executed. Read its stdout in the reply. Check the workspace root is writable and note the uid the backend runs as.
- **Expected:** The run happens in an isolated container spawned by the prod driver, the script's real output comes back, and checks 1 and 2 still hold under this driver.
- **Mock gap:** Dev and prod isolate by different mechanisms. CI drives the dev one, so the prod path's permission and uid story is only ever verified by hand.
- **Backing test:** `skill-scripts.spec.ts` · `real-third-party-mcp-sandboxed.spec.ts` · `admin-sandbox.spec.ts`

### 4 — The sweep runs unattended
- **Steps:** On the prod stack, create a workspace and let it age past its TTL. Create another and leave it fresh. Wait for the scheduler's own interval. Do not trigger the sweep by hand.
- **Expected:** The expired workspace is swept. The fresh one survives.
- **Mock gap:** CI only ever triggers the sweeps through a diagnostic hook, so a broken schedule would pass CI and never sweep in prod.
- **Backing test:** `sandbox-workspace-ttl-cron.spec.ts` · `admin-system-jobs.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The sandbox panel on `/admin/system` lists workspaces, and its sweep affordance fires.
A blocked egress reads as a friendly error, never as a hang the visitor interprets as slowness.
A job listed as scheduled shows when it last ran — a schedule with no last-run is indistinguishable from one that never fires.
