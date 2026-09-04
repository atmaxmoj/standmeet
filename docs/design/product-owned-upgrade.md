# Product-owned upgrade

Status: **implemented 2026-09-02** (app-side + updater + wiring; the real-host recreate is the
one piece still unverified — see "What's verified" below). Raised by the owner: "the *product*
has to own the upgrade capability — you can't be going into my Coolify." Before this, upgrade
was punted to a manually-configured redeploy webhook, which the code itself admits most
self-hosters can't set up, so the button was dead by default.

## What was built

- **App-side signal path** (`backend/cmd/server/port/upgrade_signal.go`): `SignalRedeployer`
  writes an atomic timestamp to a file on a volume it shares with a sidecar, instead of POSTing
  an owner-supplied webhook. `Configured()` is true whenever the sidecar shipped, so `can_apply`
  is true out of the box. The app still never gets docker.sock — it writes one byte to a file.
- **Composition root — one path, no fork** (`boot_upgrade.go` `upgradeSources`): the redeploy side
  is always `SignalRedeployer`, never a choice the product makes. The webhook branch (and
  `RedeployHookURL` / `STANDMEET_REDEPLOY_HOOK`) was removed 2026-09-04 — it was the product
  half-knowing its substrate. `Configured()` false (no signal path) is the honest can't-act state.
  Config reads `STANDMEET_UPGRADE_SIGNAL` (`config.go`).
- **Updater = a small Go binary, Watchtower's mechanism narrowed to a button** (`infra/updater/`,
  its own Go module so the docker SDK never enters the backend's graph). The backend only emits a
  **substrate-blind pulse**; this worker is the one container with docker access. On the pulse it:
  - reads its **OWN** container's `com.docker.compose.project` label to learn the real project
    name (never hardcoded), lists the siblings, and **recreates each of ours in place** from its
    own inspected config (`ContainerInspect` → stop → remove → `ContainerCreate` with the same
    Config/HostConfig/Networks, only `Image` bumped to the channel tag). So volumes, networks, env
    (**the secrets**), names and labels are exactly what they already were.
  - **No compose fetched, no `.env`, no project name given** — it only ever acts on the containers
    that already exist, so it works identically on bare `docker compose`, Coolify, or anything.
  - **Why the rewrite (2026-09-04):** the earlier version ran `docker compose -p standmeet up`
    against a *fetched canonical compose*. That (a) **hardcoded** the project name, so on any
    deployment whose real project name differed (Coolify uses its own) `up` built a **parallel
    EMPTY stack** instead of upgrading the real one — verified live on sijie.xyz, it spun a twin
    with fresh volumes; and (b) needed the secrets as `${SERVICE_PASSWORD_*}` from an `.env` it
    couldn't get (those were Coolify-magic var names — the "canonical" compose was itself PaaS-
    flavored). Both are deployment knowledge the product must not have. In-place recreate has
    neither problem. Trade-off: it bumps image tags, it does **not** change the stack's *shape*
    (add/remove services) — a rare need, punted.
- **Deploy compose** (`infra/deploy/docker-compose.yml`, renamed from the Coolify-specific
  file): ships the `updater` service + the shared `upgrade_signal` volume + docker.sock into the
  updater only, and moves the image tags to `${STANDMEET_IMAGE_TAG:-latest}` so a redeploy lands
  on the newest release.
- **Release** (`Makefile` `IMAGES`): `standmeet-updater` builds + pushes with the rest.

## What's verified vs. still open

- **Verified here:** the app writes the signal atomically and `can_apply` reflects it
  (`upgrade_signal_test.go`, `boot_upgrade_test.go`). And a **real, honest** end-to-end
  (`infra/updater/updater-e2e.sh`, `make updater-e2e`): a live stack brought up with `docker
  compose` (real project, a real named volume with data), the updater deployed as part of it and
  **told nothing about the project**, a unique marker written to the volume, a v2 image published,
  the button pressed → asserts the service upgraded **in place** to v2, **the marker survived**
  (original volume adopted, not a fresh one), and **no parallel container/volume appeared**. The
  marker-survives + no-twin checks are exactly what the previous (rigged) test lacked — it handed
  the updater the matching project name and the same compose, so it could never see the twin bug.
  2026-09-04, green.
- **Verified live + fixed:** pressing the button on sijie.xyz (Coolify) with the OLD updater built
  a parallel empty stack (the twin bug above); the real instance was untouched (domain → Coolify's
  stack, data intact). Root-caused to the hardcoded project + fetch-canonical secrets, rewritten to
  in-place recreate. The Coolify instance still needs a one-time Coolify redeploy to swap in the new
  updater image (the old updater excludes itself, and can't fix itself).
- **Done 2026-09-04:** the composition root no longer chooses between adapters. The webhook
  redeployer + `RedeployHookURL` + `STANDMEET_REDEPLOY_HOOK` are gone; the product emits one
  substrate-blind signal and knows nothing about who consumes it.

## The problem, in the code's own words

- (Historical) `config.go` `RedeployHookURL` used to POST an **opaque URL the owner pastes** from
  Coolify/Portainer/CI, off by default — the product half-knowing its substrate. Removed
  2026-09-04: the product emits only the substrate-blind signal.
- `infra/deploy/docker-compose.yml` (the image-based deploy compose): the deploy webhook path is
  impractical for most self-hosters. **Fixed** by the updater sidecar (the default path now).
- That compose used to pin every image at **`v0.1.3`** (not `latest`, not the current release),
  so even if the webhook fired, a redeploy would pull v0.1.3. **Fixed** — tags are now
  `${STANDMEET_IMAGE_TAG:-latest}`, and the release pushes `latest` on every cut.

Net effect observed: `sijie.xyz` is stuck on v0.1.6 with v0.1.10 published; `instance.upgrade_check`
returns `available: true, can_apply: false` — nothing is wrong with the release, the instance
just has **no way to act on it**.

## The invariant we must not break

**The main app never gets docker.sock.** That's the line that keeps a compromised app from
becoming host control (prompt-injection-is-buffer-overflow, in the owner's own corpus). Any
upgrade design must preserve it — the privilege to pull+recreate lives somewhere *else*, small
and auditable, never in the app that faces the internet.

## Recommended: a product-shipped updater sidecar

Ship an **updater** container as part of the product's own compose:

- It holds the docker privilege. **Shipped v1 mounts the raw socket into the updater only** (the
  standard Watchtower-style posture); the app stays sock-free, which is the invariant that
  matters. A `docker-socket-proxy` in front is the planned hardening step — but note it can't
  actually scope to one project (its whitelist is endpoint-level, e.g. `containers`/`images`, not
  resource-level), so on a shared host it narrows the *endpoints* the updater can call, not the
  *containers* it can touch. The real project-scoping is the updater's own `-p standmeet`.
- The **app stays docker.sock-free.** `instance.upgrade` stops POSTing an owner webhook and
  instead **signals the updater** (a request on the internal network, or a target-version file
  on a shared volume the updater watches). The app says "go to vX"; the updater does the
  privileged part.
- The updater **pulls the target version's images and recreates the stack's services**
  (`docker compose pull && up -d` scoped to the project, or the equivalent API calls).
- Because it ships *in the compose*, upgrade works **out of the box — zero owner config, no
  external orchestrator, no touching anyone's Coolify.**
- (Superseded 2026-09-04) An earlier revision kept `STANDMEET_REDEPLOY_HOOK` as an optional
  fallback. It was removed: a webhook the product POSTs is the product knowing its substrate. A
  non-docker substrate is a different **adapter** reading the same signal, not a product knob.

Security posture vs today: the app's surface is unchanged (still no sock). We add exactly one
small, single-purpose container whose docker access is proxy-narrowed to pull+recreate this
project. That's a real, bounded increase — and it's the standard shape for self-hosted
self-update (Watchtower is this pattern; we want it scoped + button-driven, not ambient).

## Alternatives (and why not)

1. **App calls the Coolify API directly.** Assumes Coolify, needs the owner's Coolify token in
   the app — couples the product to one orchestrator and puts a host-control credential inside
   the internet-facing app. Worse than the sidecar on both counts.
2. **Watchtower proper.** Ambient auto-update on any new image; no button, no control over
   *when* or *which version*, and it watches all containers unless scoped. The sidecar is
   Watchtower's mechanism narrowed to our button + our project.
3. **Give the app scoped docker via a proxy directly.** Removes the sidecar but puts the docker
   client in the app — the invariant says no. The sidecar exists precisely to keep that client
   out of the app.

## Bootstrap (the chicken-and-egg)

Existing instances (e.g. sijie.xyz) don't have the updater yet, so the *first* hop to the
updater-bearing compose is a one-time manual redeploy by the owner. After that hop, every
future upgrade is the in-product button. New instances get it from day one.

## Also fix (independent of the sidecar)

- The compose image tags: either the release step rewrites them to the new version, or they
  move to a channel tag (`:stable`) the updater repoints — pinning `v0.1.3` by hand is how
  sijie.xyz would have redeployed to the *wrong* version.

## Open questions

- Signal transport app→updater: internal HTTP on the compose network, or a watched file on a
  shared volume (survives the app being mid-restart)? The file is more robust.
- Recreate mechanism: does the updater run `docker compose` against the project file, or drive
  the container API directly? Compose is simpler but needs the compose file mounted.
- Health-gated rollback: if the new version fails its healthcheck, should the updater roll back
  to the previous image tag automatically? (The upgrade op already only reports "requested";
  the real receipt is the version poll — a failed poll could trigger rollback.)
- On a Coolify-managed stack, does an in-stack updater recreating sibling services fight
  Coolify's own reconciliation? Needs a real test on the shared host before shipping.
