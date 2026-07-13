# §N — Prod deploy-config forks

- **Status:** ⬜ not-run
- **Scope:** runnable-now · observe prod stack
- **Prereqs/creds:** none beyond a running prod stack (`make prod-up` → `docker-compose.prod.yml`). This item is mostly **config observation** — reading the live prod stack's env/defaults against what the dev/e2e stack sets, and confirming the prod-default branch behaves.
- **Real service:** the running `docker-compose.prod.yml` configuration itself — the env deltas between the dev/e2e stack (which sets mock overrides + test env) and the prod stack (which unsets them and falls to code defaults). Every path here is a branch CI only ever runs with the dev value.
- **Backing e2e:** (attribution targets) `plugin-discovery-chat` · `real-third-party-mcp-loader` · `sandbox-workspace-ttl-cron` · `admin-sandbox` · `agent-turn-endpoint` · `security-captcha-bypass` · `writings` · `resume-pdf-render`

> These are prod defaults, not credentials — the point is to confirm that when the dev-only env is absent, the prod-default branch still works (or to name the fork so it isn't silently assumed). Read each key in `docker-compose.prod.yml` and diff it against `docker-compose.dev.yml`.

## Sub-items

### N1 — `STANDMEET_PLUGINS` unset in prod → no managed MCP-app plugins load
- **Steps:** confirm prod's backend env carries **no** `STANDMEET_PLUGINS` (dev sets `STANDMEET_PLUGINS=/etc/standmeet/plugins.json`, `docker-compose.dev.yml:128`). On the prod stack, `registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), …)` gets an empty path → no managed plugin source registers. Then register a real owner-side plugin and confirm it loads in prod.
- **Expected:** with the env unset, zero platform-declared plugins load at boot (the dev fixture plugins are gone); a real owner-registered plugin still discovers + dispatches in visitor chat.
- **⚠️ config fork:** `backend/cmd/server/plugins.go:31` reads `STANDMEET_PLUGINS`; prod compose omits it entirely, so the whole platform-declared-plugin discovery path CI exercises (`plugin-discovery-chat`) runs on a source that does not exist in prod.
- **Backing test:** `plugin-discovery-chat.spec.ts:53` · `real-third-party-mcp-loader.spec.ts:55`
- **Result:** ⬜

### N2 — `SANDBOX_WORKSPACE_ROOT` default + prod isolation posture
- **Steps:** confirm prod carries no `SANDBOX_WORKSPACE_ROOT` → it falls to `defaultWorkspaceRoot = "/srv/sandbox-workspaces"` (`backend/cmd/server/sandbox_workspaces.go:21`). Confirm the prod backend runs as **root** (`user: "0:0"`, `docker-compose.prod.yml:98`) with `SANDBOX_DRIVER=docker` — the docker-driver (sibling containers via the socket), not bwrap-in-backend. Run a real sandbox skill and confirm the per-session workspace is created writable under the default root and cron-swept on TTL.
- **Expected:** the default workspace root is writable; a sandbox skill runs under the prod docker-driver isolation; expired workspaces are cron-swept, fresh ones survive.
- **⚠️ config nuance:** inventory §N2 assumed the workspace is "writable as uid 1001," but the prod backend actually runs as `0:0` (root) so it needs the docker socket for sibling-container sandboxing — verify the real uid/permission story, don't assume 1001.
- **Backing test:** `sandbox-workspace-ttl-cron.spec.ts:73` · `admin-sandbox.spec.ts`
- **Result:** ⬜

### N3 — `AGENT_TURN_TIMEOUT` 120s prod default
- **Steps:** confirm prod carries no `AGENT_TURN_TIMEOUT` → it falls to `defaultAgentTurnTimeout = 120 * time.Second` (`backend/internal/inference/agent_turn.go:32`, selected by `agentTurnTimeout()` at `:35`). Drive a real long-running turn and confirm the 120s cap applies (CI only ever sets a short test timeout to exercise the error path).
- **Expected:** with the env unset, the agent turn caps at 120s in prod; a turn that exceeds it surfaces a friendly timeout error, not a crash.
- **⚠️ config fork:** the short-timeout error path CI validates only fires under a dev/e2e override; the real 120s default branch is never driven.
- **Backing test:** `agent-turn-endpoint.spec.ts:101`
- **Result:** ⬜

### N4 — `TURNSTILE_*` unset in BOTH composes → captcha off by default
- **Steps:** confirm neither `docker-compose.prod.yml` nor `docker-compose.dev.yml` sets `TURNSTILE_SITEKEY`/`TURNSTILE_SECRET` → `NewFromConfig` returns `ProviderNone` (`backend/internal/captcha/captcha.go:65`) and the noop verifier is wired. Captcha is a **permissive default the owner must opt into** (see §G for the real-key path).
- **Expected:** out of the box, prod runs with captcha OFF (noop verifier); this is a deliberate permissive default, not a bug — name it so a deploy isn't assumed to be captcha-protected. The IP hard-lock (not captcha) is what guards a locked IP by default.
- **⚠️ config fork:** the entire real-siteverify branch (§G) is dark until the owner supplies keys; CI's captcha assertions all run against the noop/off posture.
- **Backing test:** `security-captcha-bypass.spec.ts:34` (asserts hard-lock holds while captcha is off)
- **Result:** ⬜

### N5 — `STORAGE_PUBLIC_URL` / `STORAGE_USE_SSL` prod values
- **Steps:** confirm prod sets `STORAGE_USE_SSL=false` (`docker-compose.prod.yml:76`) and `STORAGE_PUBLIC_URL=${STORAGE_PUBLIC_URL}` (`:78`, owner-supplied public storage origin). Upload a real cover image / media asset → confirm the `standmeet-asset:<id>` URI resolves to a presigned URL built on the prod `STORAGE_PUBLIC_URL` and the image actually renders on `/writings`.
- **Expected:** presigned URLs are minted against the owner's real public storage origin and render browser-side; note `STORAGE_USE_SSL=false` is set even in prod (the TLS terminates at the front proxy, storage is plain-http inside the compose network) — flag it so it isn't mistaken for a misconfig.
- **⚠️ config nuance:** `STORAGE_USE_SSL=false` in prod is intentional (in-network MinIO behind the TLS proxy), but the presigned-URL host comes from `STORAGE_PUBLIC_URL` which must be the public origin — verify the browser-facing URL is correct, not the internal `minio:9000` endpoint.
- **Backing test:** `writings.spec.ts:136` (owner uploads cover image → presigned render) · `resume-pdf-render.spec.ts:55` (sibling `PRINT_BASE_URL` prod posture)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-N-n`)
