# §K — Sandbox egress

- **Status:** ⬜ not-run
- **Scope:** `runnable-now`
- **Prereqs/creds:** none external. Needs the **prod stack** (`make prod-up`) so the sandbox runs under the real **docker-driver** isolation (sibling containers via `docker.sock`), not the dev bwrap-in-backend path. A local payload origin (the real egress target that `payload-origin:7070` faked in dev) or any reachable local URL to fetch.
- **Real service:** real container network isolation (`--network=none` vs an `AllowNet` allowlist) · the **prod docker driver** (sibling-container spawn) instead of bwrap-in-backend · the **real scheduler** (cron) instead of the on-demand diag hook.
- **Backing e2e:** (attribution targets) `real-third-party-mcp-network` · `real-third-party-mcp-escape` · `real-third-party-mcp-sandboxed` · `real-third-party-mcp-loader` · `sandbox-workspace-ttl-cron` · `admin-sandbox` · `skill-scripts` · `admin-system-jobs`

## Sub-items

### K1 — AllowNet vs default-deny (`--network=none`)
- **Steps:** run a sandboxed skill/tool that fetches a reachable local payload URL **with** net access granted (AllowNet) → confirm the fetch succeeds. Then run the identical fetch under the default `--network=none` → confirm it is **blocked** (egress denied), and the block surfaces as a friendly error, not a hang or a stack trace.
- **Expected:** AllowNet → the sandbox really downloads the payload; default → the same fetch is denied at the container network layer. Also verify escape vectors stay closed: cannot reach the host docker socket, cannot read host config (`/etc/standmeet/plugins.json`).
- **Backing test:** `real-third-party-mcp-network.spec.ts:68` (AllowNet: real server downloads the local payload) · `real-third-party-mcp-network.spec.ts:90` (default `--network=none`: identical fetch blocked) · `real-third-party-mcp-escape.spec.ts:55` (cannot reach host docker socket) · `real-third-party-mcp-escape.spec.ts:79` (cannot read host config)
- **Result:** ⬜

### K2 — Sandbox under prod isolation (docker-driver, not bwrap-in-backend)
- **Steps:** on the **prod** stack, run a sandbox skill (e.g. `skill_run_script`) and confirm it executes in a **sibling container** spawned via `docker.sock`, not via the dev bwrap-inside-the-backend path → assert the script's stdout returns in the reply.
- **Expected:** the prod driver spawns an isolated sibling container, runs the real script, and the isolation guarantees from K1 (no host socket, no host FS, egress gating) all hold under this driver too.
- **⚠️ mock/env gap:** dev runs bwrap *inside* the backend container; prod uses the docker driver — a different isolation mechanism CI never drives on the prod path. Verify the prod driver spawns and cleans up correctly and that a build/skill actually runs there.
- **Backing test:** `skill-scripts.spec.ts:53` (AI calls `skill_run_script` → sandbox runs → stdout in reply) · `real-third-party-mcp-sandboxed.spec.ts` (sandboxed loader run) · `admin-sandbox.spec.ts:42` (owner lists workspaces + runs sweep)
- **Result:** ⬜

### K3 — Real cron fires on schedule
- **Steps:** on the prod stack, let the **real scheduler** run (do not trigger the diag hook) → confirm the workspace-TTL sweep (and resume-draft TTL sweep) actually fires on its schedule → an expired workspace is swept while a fresh one survives.
- **Expected:** the scheduled sweep runs unattended at its interval and evicts only expired workspaces; a workspace created after the cutoff is retained.
- **⚠️ mock gap:** the workspace / resume-draft sweeps are only ever run **on-demand via a diag hook** in CI (inventory §K3, `[scan]`) — the real cron scheduler is never exercised, so a broken/misconfigured schedule would pass CI and never sweep in prod. Verify the timer itself fires.
- **Backing test:** `sandbox-workspace-ttl-cron.spec.ts:73` (expired workspace is cron-swept; a fresh one survives) · `admin-system-jobs.spec.ts` (system jobs panel) · `resume-draft-ttl.spec.ts` (resume-draft TTL, sibling sweep)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-K-n`)
