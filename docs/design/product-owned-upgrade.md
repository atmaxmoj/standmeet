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
- **Composition-root choice** (`boot_upgrade.go` `pickRedeployer`): an explicit
  `STANDMEET_REDEPLOY_HOOK` still wins (advanced owners with an orchestrator); otherwise the
  signal path is the default; only when neither is set does the button honestly report it can't
  act. Config reads `STANDMEET_UPGRADE_SIGNAL` (`config.go`).
- **Updater = the DOCKER adapter, not "the upgrade mechanism"** (`infra/updater/`). Ownership
  boundary (revised 2026-09-04): the backend only emits a **substrate-blind pulse** (the signal);
  it never knows how it's deployed. This `docker:cli` worker is the *docker substrate's* adapter —
  one of potentially many (a k8s or bare-git deployment binds a different adapter to the same
  pulse). The product does not know this adapter exists or that it's docker.
  - It does **not** mount this instance's on-disk compose (that bound the upgrade to how *this*
    instance was laid down, and broke on a PaaS that keeps the compose only in its DB). Following
    **Coolify's own self-upgrade**, it **fetches the canonical compose from the release**
    (`STANDMEET_COMPOSE_URL`) at upgrade time, passes the local `.env` for secrets, then
    `docker compose pull && up -d` excluding itself. So an upgrade can change the stack's *shape*,
    not just bump tags, and needs no compose file on disk.
- **Deploy compose** (`infra/deploy/docker-compose.yml`, renamed from the Coolify-specific
  file): ships the `updater` service + the shared `upgrade_signal` volume + docker.sock into the
  updater only, and moves the image tags to `${STANDMEET_IMAGE_TAG:-latest}` so a redeploy lands
  on the newest release.
- **Release** (`Makefile` `IMAGES`): `standmeet-updater` builds + pushes with the rest.

## What's verified vs. still open

- **Verified here:** the app writes the signal atomically and `can_apply` reflects it
  (`upgrade_signal_test.go`, `boot_upgrade_test.go`). And now a **real** end-to-end (`infra/updater/
  updater-e2e.sh`, `make updater-e2e`): a live local registry, a live stack, a served **canonical
  compose the updater fetches over HTTP**, a genuine `:latest` bump, a real signal → the running
  container is actually recreated to the newer image, and a repeat press is a no-op. This targets
  the **new** design (fetch canonical, not mount local) — 2026-09-04, green.
- **Still open (needs a real PaaS host):** whether an in-stack updater fights a PaaS's own
  reconciliation loop (Coolify etc.). Not a reason to keep the local-compose coupling — on a
  managed PaaS you drop the updater entirely and point `STANDMEET_REDEPLOY_HOOK` at the platform's
  redeploy webhook (the platform is the adapter there).
- **Remaining product-side cleanup:** `boot_upgrade.go` still *chooses* between the webhook and
  signal redeployers (`if RedeployHookURL != ""`). That branch is the product half-knowing its
  adapters; collapsing it to a single "emit intent" path is the next step.

## The problem, in the code's own words

- `config.go` (`RedeployHookURL`): the instance has no docker.sock (deliberate), so it can't
  pull/recreate itself. It POSTs an **opaque URL the owner pastes** from Coolify/Portainer/CI.
  "Empty = the button honestly says it can't." → upgrade is **owner-configured, off by default.**
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
- `STANDMEET_REDEPLOY_HOOK` **survives as an optional fallback** for advanced users who genuinely
  have an orchestrator webhook — but it's no longer the only path, and off-by-default stops
  meaning can't-upgrade.

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
