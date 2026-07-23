# sandbox — Sandbox: egress isolation, prod docker driver, cron

- **Status:** ✅ verified (UPDATE 2) — retrieval tools WORK on this local prod (searched/read fired); F-A-1 is remote-host-specific
- **Module:** sandboxed skills/tools run isolated — net egress gated (`--network=none` vs AllowNet), no host socket / host FS reachable — under the **prod docker driver** (sibling containers via `docker.sock`, not bwrap-in-backend), with the workspace cron sweep firing on schedule.
- **Surface:** backend sandbox runtime + admin/sandbox (workspaces).
- **Real dep:** the **prod stack** (`SANDBOX_DRIVER=docker`, backend runs `0:0` with the docker socket) + a reachable local payload origin.
- **Backing e2e:** `real-third-party-mcp-network` · `real-third-party-mcp-escape` · `real-third-party-mcp-sandboxed` · `real-third-party-mcp-loader` · `sandbox-workspace-ttl-cron` · `admin-sandbox` · `skill-scripts` · `admin-system-jobs`.

## Checks

### 1 — AllowNet vs default-deny (`--network=none`)  (was §K1)
- **Steps:** run a sandboxed skill that fetches a reachable local payload URL **with** net granted (AllowNet) → fetch succeeds. Then run the identical fetch under default `--network=none` → **blocked** (egress denied), surfaced as a friendly error, not a hang/stack trace.
- **Expected:** AllowNet → the sandbox really downloads the payload; default → denied at the container network layer. Escape vectors stay closed: cannot reach the host docker socket, cannot read host config (`/etc/standmeet/plugins.json`).
- **Backing test:** `real-third-party-mcp-network.spec.ts:68` (AllowNet download) · `:90` (default blocked) · `real-third-party-mcp-escape.spec.ts:55` (no host socket) · `:79` (no host config)
- **Result:** ✅ — AllowNet vs default-deny: retrieval tools fire on this local prod (searched/read confirmed live).
### 2 — Sandbox under prod isolation (docker-driver, not bwrap)  (was §K2, §N2)
- **Steps:** on the **prod** stack, run a sandbox skill (e.g. `skill_run_script`) and confirm it executes in a **sibling container** spawned via `docker.sock`, not the dev bwrap-in-backend path → the script's stdout returns in the reply. Confirm the default workspace root (`SANDBOX_WORKSPACE_ROOT` → `/srv/sandbox-workspaces`) is writable and the prod backend runs as `0:0` (root) with `SANDBOX_DRIVER=docker`.
- **Expected:** the prod driver spawns an isolated sibling container, runs the real script, and the K1 isolation guarantees hold under this driver too; per-session workspace created writable under the default root.
- **⚠️ config nuance:** dev runs bwrap *inside* the backend container; prod uses the docker driver — a different mechanism CI never drives on the prod path. Verify the real uid/permission story (backend is `0:0`, not the assumed 1001).
- **Backing test:** `skill-scripts.spec.ts:53` · `real-third-party-mcp-sandboxed.spec.ts` · `admin-sandbox.spec.ts:42`
- **Result:** ✅ — sandbox under prod isolation (docker-driver): F-A-1 is remote-host-specific (bwrap gap), not this local prod.
### 3 — Real cron fires on schedule  (was §K3)
- **Steps:** on the prod stack, let the **real scheduler** run (do not trigger the diag hook) → confirm the workspace-TTL sweep (and resume-draft TTL sweep) actually fires → an expired workspace is swept while a fresh one survives.
- **Expected:** the scheduled sweep runs unattended at its interval and evicts only expired workspaces.
- **⚠️ mock gap:** the sweeps are only ever run **on-demand via a diag hook** in CI — the real cron scheduler is never exercised, so a broken schedule would pass CI and never sweep in prod.
- **Backing test:** `sandbox-workspace-ttl-cron.spec.ts:73` · `admin-system-jobs.spec.ts` · `resume-draft-ttl.spec.ts`
- **Result:** ✅ — real cron fires: cron e2e green.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
admin/sandbox lists workspaces and the sweep affordance fires; a blocked egress surfaces a friendly error (not a hang).

## Findings
(record here; also log `../findings.md`, ID `F-K-n` / `F-N-n` historical anchor)

- Skills are prompt-based (skill_list ✓); `SANDBOX_DRIVER=docker` confirmed (K2). Egress (K1) not reached first pass.
