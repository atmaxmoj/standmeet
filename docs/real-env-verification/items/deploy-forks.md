# deploy-forks — Prod deploy-config forks

- **Status:** ✅ confirmed first pass — re-verify each prod-default branch behaves
- **Module:** the prod-default branches CI never runs with the dev value — plugins unset, 120s turn timeout, captcha off — behave correctly (or are named so they aren't silently assumed).
- **Surface:** the running `docker-compose.prod.yml` config (observation) + the branches it selects.
- **Real dep:** a running prod stack (`make prod-up`). Config observation — read each key and diff against `docker-compose.dev.yml`.
- **Backing e2e:** `plugin-discovery-chat` · `real-third-party-mcp-loader` · `agent-turn-endpoint` · `security-captcha-bypass`.

## Checks

### 1 — `STANDMEET_PLUGINS` unset in prod → no managed MCP-app plugins load  (was §N1)
- **Steps:** confirm prod's backend env carries **no** `STANDMEET_PLUGINS` (dev sets it). On prod, `registerPluginSource` gets an empty path → no managed plugin source registers. Then register a real owner-side plugin and confirm it loads in prod.
- **Expected:** with the env unset, zero platform-declared plugins load at boot; a real owner-registered plugin still discovers + dispatches in visitor chat.
- **⚠️ config fork:** `backend/cmd/server/plugins.go:31` reads `STANDMEET_PLUGINS`; prod compose omits it, so the whole platform-declared-plugin discovery path CI exercises runs on a source that does not exist in prod.
- **Backing test:** `plugin-discovery-chat.spec.ts:53` · `real-third-party-mcp-loader.spec.ts:55`
- **Result:** ✅ (plugins unset confirmed)

### 2 — `AGENT_TURN_TIMEOUT` prod default  (was §N3)
- **Steps:** confirm prod carries no `AGENT_TURN_TIMEOUT` → it falls to the code default (`agent_turn.go`), selected by `agentTurnTimeout()`. Drive a real long-running turn and confirm the cap applies (CI only ever sets a short test timeout to exercise the error path).
- **Expected:** with the env unset, the agent turn caps at the prod default; a turn that exceeds it surfaces a friendly timeout error, not a crash. (Note: the boundary itself now synthesizes — see [[agent-turn-boundary]] / F-A-4, which raised the default to 300s.)
- **⚠️ config fork:** the short-timeout error path CI validates only fires under a dev/e2e override; the real default branch is never driven.
- **Backing test:** `agent-turn-endpoint.spec.ts:101`
- **Result:** ✅ (timeout unset confirmed)

### 3 — `TURNSTILE_*` unset in BOTH composes → captcha off by default  (was §N4)
- **Steps:** confirm neither compose sets `TURNSTILE_SITEKEY`/`SECRET` → `NewFromConfig` returns `ProviderNone` (`captcha.go:65`) and the noop verifier is wired. Captcha is a **permissive default the owner opts into** (see [[captcha]]).
- **Expected:** out of the box prod runs with captcha OFF (noop); this is deliberate, not a bug — name it so a deploy isn't assumed captcha-protected. The IP hard-lock (not captcha) guards a locked IP by default.
- **⚠️ config fork:** the entire real-siteverify branch is dark until the owner supplies keys.
- **Backing test:** `security-captcha-bypass.spec.ts:34` (hard-lock holds while captcha off)
- **Result:** ✅ (turnstile unset confirmed)

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Config-only module — no owner screen; the "look" is that each fork is *named* so a deploy isn't silently assumed to have plugins / captcha / a short timeout.

## Findings
(record here; also log `../findings.md`, ID `F-N-n` historical anchor)

- **✅ confirmed** (first pass): plugins/turnstile/timeout unset, docker driver, storage SSL off (matches inventory). (`SANDBOX_WORKSPACE_ROOT`/isolation → [[sandbox]]; `STORAGE_*` → [[corpus-media]].)
