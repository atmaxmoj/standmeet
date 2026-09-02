# Root Makefile —— aggregates lint + build + test for backend / app / sdk / e2e.
# Single entry point `make lint` runs the whole chain; lefthook pre-commit calls it. CI calls it too.
#
# Each subproject's actual lint chain is defined in its own Makefile / package.json.
# A subproject with no deps installed (no node_modules) or no src auto-skips, so
# lefthook doesn't get blocked by a subproject that isn't wired up yet during early
# incremental development.

.PHONY: lint secrets secrets-image release-build release-assert-stripped release-assert-multiarch release-assert-version release-push release-gc release-repro release-repro-logs release-repro-down backend-lint backend-test plugin-test backend-no-mock app-lint sdk-lint e2e-lint env-lint im-bridge-test im-bridge-up im-bridge-logs
.PHONY: dev dev-up dev-rebuild dev-down prod-up prod-down prod-logs build clean test test-fresh test-only test-red test-captcha test-boundary mobile-shots mobile-shots-asis archive-failures sdk-build builder-vendor dev-rebuild-builder app-build sqlc-gen gateway-up eval-smoke eval-ghost eval-ask eval-compaction eval-doc-context eval-cross-conversation eval-interview eval-summary eval-capabilities eval-owner-mcp verify-round schema-drift i18n-keys

# ── lint ────────────────────────────────────────────────────────
# Order: env-lint is fastest, so it runs first; backend's own `make lint` chain is
# already rich; the frontends each run eslint + tsc + knip. backend-no-mock is the
# G-Y-mandated "backend must not contain mock-only code" constraint.
lint: secrets env-lint backend-lint backend-no-mock app-lint sdk-lint e2e-lint im-bridge-test verify-items

# secrets —— secret scan, runs first: it takes 5 seconds, and what it guards against has no undo.
#
# This step used to live in the `backend/lint` chain, and it **never scanned anything**: that
# target only ran inside `backend/`, while the repo's `.git` is one level up, so `[ -d .git ]`
# was always false → every run printed one "skipping" line and exited 0 (F-H-6).
secrets:
	@infra/scripts/check-secrets.sh

# lint-cached —— runs lint, but only once per unchanged tree (see the script header: a
# product of the 2026-08-18 efficiency review). `pre-commit` goes through this; a human
# running `make lint` by hand should too. Escape hatch: FORCE_LINT=1.
lint-cached:
	@infra/scripts/lint-if-dirty.sh

env-lint:
	@LINT_ENV_EXCLUDE="standmeet-client standmeet-server standmeet-e2e" \
	  infra/scripts/lint-env "$$(pwd)"
	@infra/scripts/check-knobs-reachable.sh
	@infra/scripts/check-knobs-reachable-test.sh
	@infra/scripts/check-redis-bounded.sh
	@infra/scripts/check-prod-ports-bound-local.sh
	@infra/scripts/check-search-index-shipped.sh
	@infra/scripts/check-custom-page-imports-declared.sh
	@infra/scripts/check-doc-make-targets.sh

backend-lint:
	@$(MAKE) -C backend lint

# backend-test —— Go unit/integration tests (testify, no DB/docker). e2e runs via `make test`.
# Also runs each plugin module's own tests under mcp-servers/: they're independent go modules,
# so `go test ./...` inside backend/ can't reach them — which is why the ask-visitor test **never
# ran, from the day it was written**.
backend-test: plugin-test
	@$(MAKE) -C backend test

# plugin-test —— each mcp-servers/<plugin> is its own module; run each one's go test separately.
plugin-test:
	@for d in mcp-servers/*/; do \
		[ -f "$$d/go.mod" ] || continue; \
		echo "[plugin-test] $$d"; \
		(cd "$$d" && go test ./...) || exit 1; \
	done

# backend-no-mock —— the G-Y gate: no mock-only / test-only code allowed anywhere in backend/
# (MockProvider / INFERENCE_MOCK_ env / /__mock URL / routes/sys/test_*).
# All mock infra lives in mock-stack/ instead. The grep excludes _test.go and // comments.
#
# Checklist:
#   1. Source patterns: MockProvider / INFERENCE_MOCK_ / __mock / TestRegistry /
#      TestVisitorCap / TestGCalExpire
#   2. Directories: backend/cmd/{job-board,mcp-server}-mock/ (should live in mock-stack/)
#   3. Files: backend/internal/routes/sys/test_*.go (should go through mock-stack admin
#      endpoints, or the spec should hit SQL/Redis directly)
#   4. Named fixture/canned stand-ins (P.13)
#   5. test-only package imports (name-INDEPENDENT: testing/testify/httptest leaking into prod)
# check-no-mock-test.sh is the checker's own self-test: plants a neutrally-named testify-import
# violation and asserts it gets caught.
# check-core-agnostic-test.sh likewise self-tests the #135 zero-capability core ratchet: plants a
# calendar leak and asserts it gets caught.
# (The ratchet itself, check-core-agnostic, already runs in backend's fast lint chain; this runs
# only its self-test.)
backend-no-mock:
	@infra/scripts/check-no-mock
	@infra/scripts/check-no-mock-test.sh
	@infra/scripts/check-core-agnostic-test.sh

# Frontend subprojects: skip if node_modules isn't installed (run pnpm install to enable).
app-lint:
	@infra/scripts/check-i18n-keys
	@infra/scripts/check-css-parses.sh
	@infra/scripts/check-one-scrim.sh
	@infra/scripts/check-one-empty-state.sh
	@infra/scripts/check-no-native-file-input.sh
	@infra/scripts/check-one-layer-scale.sh
	@infra/scripts/check-one-section-heading.sh
	@infra/scripts/check-one-corpus-href.sh
	@infra/scripts/check-one-select.sh
	@infra/scripts/check-one-text-input.sh
	@infra/scripts/check-one-time-format.sh
	@infra/scripts/check-no-computed-class.sh
	@infra/scripts/check-sm-class-defined.sh
	@infra/scripts/check-peek-signals-more.sh
	@infra/scripts/check-tool-paths-exist.sh
	@infra/scripts/check-instructions-name-sure-tools.sh
	@if [ -d app/node_modules ] && [ -f app/package.json ]; then \
	  cd app && pnpm lint; \
	else \
	  echo "[skip] app/ has no node_modules or package.json — skipping"; \
	fi

sdk-lint:
	@if [ -d sdk/packages/core/node_modules ]; then \
	  cd sdk && pnpm -r lint; \
	else \
	  echo "[skip] sdk/ has no node_modules — skipping"; \
	fi

# im-bridge-test —— the IM bridge's unit tests. **These don't go into e2e**: the bridge is an
# external visitor client, and its logic (code auth / open session / quota / revoke / echo
# guard) can be proven against a stand-in without spinning up the whole stack.
# The real-platform pass belongs to docs/real-env-verification/items/im-bridge.md.
im-bridge-test:
	@if [ -d im-bridge/node_modules ]; then \
	  pnpm -F @standmeet/im-bridge lint && pnpm -F @standmeet/im-bridge test; \
	else \
	  echo "[skip] im-bridge/ has no node_modules — skipping"; \
	fi

# im-bridge-up —— starts the IM bridge. **No environment variables needed**: the bot token is
# the connector credential the owner configured in admin; the bridge fetches it from the
# internal API on startup. Without it configured, it just idles.
im-bridge-up:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --build im-bridge

im-bridge-logs:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml logs -f --tail=100 im-bridge

e2e-lint:
	@if [ -d e2e/node_modules ]; then \
	  cd e2e && pnpm lint; \
	else \
	  echo "[skip] e2e/ has no node_modules — skipping"; \
	fi

# ── dev / build / test ──────────────────────────────────────────
dev:
	@docker compose -f docker-compose.dev.yml up

# sdk-build —— builds sdk-core/sdk/embed, all three packages, via tsup into dist/ for app to dogfood.
# app-build runs sdk-build first, so Next can find @standmeet/sdk-core/dist at compile time.
# builder-vendor —— copies the SDK build output into the custom-page builder's build context.
#
# **Why this step must exist**: inside the builder image, an owner's page can only import
# whatever is in /opt/builder/node_modules — and that only has react/vite in it — so a hosted
# page can do nothing but render text (no corpus, no agent). The SDK is a workspace package, not
# a published one, and the builder's build context is ./builder, so the image's COPY can't reach
# sdk/ — it has to be copied over first.
#
# ⚠️ Same family as `prod-app: app-build`: **produce the artifact where it's consumed, first**,
# and this family's failure mode is copying over a **stale** artifact and still reporting success.
# The script therefore never copies silently: missing → build it; done → report what it copied.
builder-vendor:
	@infra/scripts/builder-vendor.sh

sdk-build:
	@pnpm -F @standmeet/sdk-core build
	@pnpm -F @standmeet/agent-core build
	@pnpm -F @standmeet/sdk build
	@pnpm -F @standmeet/embed build
	@pnpm -F @standmeet/mcp-client build

# app-build —— pnpm build on the host, producing .next/standalone for the docker image to COPY.
# Host build chosen over docker build: pnpm install inside node:22-alpine often hits < 50 KiB/s
# against the npm registry (macOS docker desktop network stack bottleneck); on the host it's 14s.
app-build: sdk-build
	@pnpm install --frozen-lockfile
	@pnpm -F standmeet-app build

dev-up: app-build builder-vendor
	@infra/plugins/provision.sh
	# Rebuild ONLY the services whose code changes every loop (app + backend). The mocks
	# (mcp-server-mock / external-mock / llm-gateway / mail-mock) also have build: contexts but rarely
	# change — `up` (without --build) reuses their existing images and builds them only the first time
	# they're missing. This keeps the per-loop rebuild to app+backend instead of all 6 build contexts.
	# If a mock's own code changes, run `make dev-rebuild-mocks` once.
	@docker compose -f docker-compose.dev.yml build app backend
	@docker compose -f docker-compose.dev.yml up -d --wait
	@echo "[dev] app=http://localhost:3000 backend=http://localhost:8000"

# dev-rebuild-builder —— rebuilds the custom-page builder image and swaps in the container.
#
# Run after changing `builder/` (runner / template / Dockerfile) **or the SDK**: what a page can
# import depends on what's in /opt/builder/node_modules inside the image, which is fixed at
# image-build time.
# Runs builder-vendor to copy the artifact first, then builds — same lesson as dev-rebuild-mocks:
# build without swapping the container and you're still running the old process, and the red
# looks exactly like a real product red.
dev-rebuild-builder: builder-vendor
	@docker compose -p standmeet-dev -f docker-compose.dev.yml build builder
	@docker compose -p standmeet-dev -f docker-compose.dev.yml up -d --no-deps builder

# dev-rebuild-mocks —— force-rebuild the mock/support images (only needed when a mock's source
# changed; the normal dev-up path reuses their cached images).
dev-rebuild-mocks:
	@docker compose -f docker-compose.dev.yml build mcp-server-mock external-mock llm-gateway mail-mock
	@# build only creates the image, **it does not swap the running container** — skip this step and,
	@# after editing mock-stack/ and running a spec, you're still hitting the old process, and the red
	@# looks exactly like a real product red (bit me once on 2026-08-17 in F-C-33:
	@# external-mock had already been up for 19 hours and I thought the new behavior was live).
	@docker compose -f docker-compose.dev.yml up -d --wait \
		mcp-server-mock external-mock llm-gateway mail-mock

# prod-up —— bring up the real production stack (self-contained: app + backend +
# db + redis + gotenberg + minio, no mocks). Reads .env (cp from .env.example).
# = dev minus the mocks, with real secrets. TLS/domain is external (front the
# app's published port with your proxy). Separate compose project + offset host
# ports so it coexists with the dev/test stack.
#
# That proxy is not only about TLS. The app hop (Next rewrites /api/* to the
# backend) adds no X-Forwarded-For, so without a proxy that sets one, NO visitor
# address ever reaches the backend: conversations record no source IP, IP bans
# have nothing to target, and the per-IP code lockout becomes one shared bucket.
# The backend says so once in its log when it happens.
prod-up: builder-vendor
	@test -f .env || { echo "create .env first: cp .env.example .env && edit"; exit 2; }
	@infra/plugins/provision.sh
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --build --wait
	@echo "[prod] app on http://localhost:38227 (front with your TLS proxy)"
	@echo "[prod] that proxy must set X-Forwarded-For — without it no visitor IP is"
	@echo "[prod] visible: no source IP on conversations, nothing for an IP ban to"
	@echo "[prod] target, and the per-IP code lockout applies to everyone at once."

# prod-app —— rebuild ONLY the prod app image (frontend-only change) from a fresh host
# `app-build`, reusing the running prod backend/db/etc. Use to ship an app-only fix when a full
# prod-up (which also rebuilds the backend) is unnecessary or blocked by an unrelated backend WIP.
prod-app: app-build
	@infra/scripts/build-cadence.sh prod-app
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build app
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --wait app
	@echo "[prod] app rebuilt (backend reused) — http://localhost:38227"

# prod-backend —— rebuilds the backend image and swaps it in (app untouched). The symmetric
# counterpart of `prod-app`.
#
# Why it's its own target: `prod-app` only builds the app image, and `prod-recreate-svc` only
# swaps the container **without building an image** — using either of those after a Go code
# change still runs the old binary. Verified this the hard way today on F-C-41's step ⑤: the
# screen looked unchanged and I almost concluded the fix hadn't taken.
# ⚠️ provision.sh must run here. Prod mounts `./infra/plugins` onto `/srv/plugins` (compose:138),
# **which shadows what was just compiled into the image**. So after changing `mcp-servers/*`,
# building the image alone still runs the old binary on the host — while this command prints
# "backend rebuilt" as if nothing were wrong. Hit this on 2026-08-18 on booker's cancel button:
# built the image three times, screen never changed, and the new class wasn't in the binary at all.
# Same family: `prod-app` needs `app-build` first (the image COPYs a host artifact). **Produce the
# artifact where it's consumed, first.**
prod-backend:
	@infra/scripts/build-cadence.sh prod-backend
	@infra/plugins/provision.sh
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build backend
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --wait backend
	@echo "[prod] backend rebuilt (app reused) — http://localhost:38227"

# prod-rebuild-builder —— the symmetric counterpart of `dev-rebuild-builder`. After changing
# builder/ or the SDK, what a page on prod can import is likewise fixed at image-build time.
prod-rebuild-builder: builder-vendor
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build builder
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --no-deps builder

prod-down:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml down

# prod-stop-svc / prod-start-svc —— stop/start **one** prod service. A tool the real-env audit
# needs repeatedly: several checks ask "what does the product say when this thing is gone?"
# (F-N-2's backend outage, admin-shell check 4's live indicator, corpus-acl check 6's load
# failure), and that can only be produced by actually stopping it.
#
#   make prod-stop-svc SVC=backend   # inject
#   make prod-start-svc SVC=backend  # must be done when finished — don't leave the instance stopped
#
# **It does not delete data**: stop is not down — the volumes and containers stay put, and
# starting it back up returns it exactly as it was.
prod-stop-svc:
	@test -n "$(SVC)" || (echo "usage: make prod-stop-svc SVC=<service>"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml stop $(SVC)

prod-start-svc:
	@test -n "$(SVC)" || (echo "usage: make prod-start-svc SVC=<service>"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml start $(SVC)

# prod-recreate-svc —— recreates one service's container, **without rebuilding the image**.
#
# Why `prod-start-svc` isn't enough: `stop` + `start` restart the **same container**, whose
# environment variables are fixed at creation time — editing `.env` and starting again still
# reads the old values. connector-security check 3 (what a connector should say after
# INSTANCE_SECRET is rotated) needs exactly "come back up with a new secret", while `prod-up`
# would rebuild the whole stack, image included.
#
#   make prod-recreate-svc SVC=backend
prod-recreate-svc:
	@test -n "$(SVC)" || (echo "usage: make prod-recreate-svc SVC=<service>"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml \
		up -d --no-deps --force-recreate --wait $(SVC)

# verify-proxy-up —— brings up the fault-injection proxy, sitting in front of the **real**
# provider (the device agent-loop-robustness's Real dep names by name). It's on the prod
# network, but **not in the prod compose file**: the production files shouldn't carry a
# service that can make calls fail.
#
#   make verify-proxy-up UPSTREAM=https://api.deepseek.com
#
# Once it's up, change the endpoint in admin's AI provider form to http://llm-fault:9500 — wire
# it through the product's own UI, don't change environment variables. **Remember to change it
# back when done driving**, or once the proxy stops, this instance has no model to use.
#
# ⚠️ **One more step is needed, or the above will fail** (hit this on 2026-08-19): the SSRF
# gate carries an allowlist (`httpx/ssrf.go`'s `EGRESS_ALLOW_HOSTS`), and **prod's is empty by
# design** ("EMPTY in prod (block everything internal)"). So pointing at it gets you back
# *"That endpoint resolves to an internal/private address and is not allowed."*,
# which reads like the product refused you, not like something is under-configured.
# To use this path, that instance's `EGRESS_ALLOW_HOSTS` needs to include `llm-fault` (dev's
# already includes `llm-gateway,external-mock`, so dev works out of the box).
# **Don't hard-code it into the prod compose file** — prod's default should stay "nothing
# internal may egress."
verify-proxy-up:
	@test -n "$(UPSTREAM)" || { echo "usage: make verify-proxy-up UPSTREAM=https://api.provider.com"; exit 2; }
	@UPSTREAM_BASE_URL=$(UPSTREAM) docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --build llm-fault
	@echo "[verify] proxy on http://localhost:39500 → $(UPSTREAM)"
	@echo "[verify] backend reaches it at http://llm-fault:9500"

verify-proxy-down:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml down

# verify-caldav-up —— brings up a **real** CalDAV server (Radicale) for connector-assembly check 5.
#
# Why not our stand-in: that check's Mock gap names exactly four missing things — the stand-in
# has no auth, doesn't understand the REPORT filter, doesn't expand recurrence rules, and answers
# every property request the same way. **Every one of those is what this check needs to verify.**
# The item's Real dep literally says "a self-run CalDAV server with auth" — so this isn't
# bypassing realism, it's exactly the equipment the item asks for.
#
#   make verify-caldav-up     # host http://localhost:35232 · backend uses http://radicale:5232
#   make verify-caldav-down   # tear down when done driving
#
# Account: verify / verify-caldav-pw (a one-shot test-bench server; password is right here in the
# compose comment so the next person to drive this doesn't have to hunt for it elsewhere).
verify-caldav-up:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --wait radicale
	@echo "[verify] radicale on http://localhost:35232 (backend: http://radicale:5232)"
	@echo "[verify] user verify / verify-caldav-pw"

verify-caldav-down:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml rm -sf radicale

# verify-api-fault-up —— the same proxy, upstream swapped for this instance's own backend, then
# points prod app's BACKEND_URL at it. What it produces is a **narrow fault**: make one specific
# admin endpoint fail on its own, and see what that block says
# (corpus-acl-editing check 6 — a load failure must not wear an empty state's clothes).
#
# Why not "stop backend" instead: that's a whole-stack outage, which tests a different path
# (already driven, and it's how F-N-2 was found). A narrow fault needs
# **the rest of the page to keep loading normally** while only one block is broken — an empty
# state and a load failure look identical, and this is exactly the setup that tells them apart.
#
#   make verify-api-fault-up
#   curl -XPOST localhost:39600/__mock/fault/arm \
#     -d '{"mode":"http_error","path_prefix":"/api/admin/roles"}'
#   …drive…
#   curl -XPOST localhost:39600/__mock/fault/reset
#   make verify-api-fault-down
#
# ⚠️ **Why this rebuilds app instead of just changing an env var**: `/api/*` goes through
# next.config.ts's rewrite, and the rewrite's target address is **baked into the build output**
# (`.next/required-server-files.json` literally has `http://backend:8000` written in it).
# The first version of this recipe only changed `BACKEND_URL` in compose — the container's
# variable really did change, but the proxy received zero traffic, because that half is never
# read at runtime. The four other places that read the same variable at runtime
# (`api/v1/agent/turn`, `print-payload`, `lib/api/public`, `lib/api/instance`) **are** read at
# runtime, so it moved on one half and not the other. That split itself is a defect (F-C-40);
# this recipe is written to match the truth of it for now.
verify-api-fault-up:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --build api-fault
	@BACKEND_URL=http://api-fault:9600 $(MAKE) app-build
	@docker compose -p standmeet-prod \
		-f docker-compose.prod.yml -f docker-compose.verify-app.yml up -d --no-deps --build app
	@echo "[verify] api-fault on http://localhost:39600 → http://backend:8000"
	@echo "[verify] prod app rebuilt with the rewrite pointing at it"
	@echo "[verify] arm:  curl -XPOST localhost:39600/__mock/fault/arm -d '{\"mode\":\"http_error\",\"path_prefix\":\"/api/admin/roles\"}'"

# verify-api-fault-down —— rebuilds app back to http://backend:8000, then stops the proxy.
# **Point app back first, then stop the proxy** — the other order leaves app pointing at a
# now-gone address for the few seconds in between.
# Also needs a rebuild: the address is baked into the artifact, so without rebuilding it keeps
# pointing at a proxy that no longer exists (see the paragraph above).
verify-api-fault-down:
	@$(MAKE) app-build
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --no-deps --build app
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml rm -sf api-fault
	@echo "[verify] prod app back on http://backend:8000"

# prod-clean —— down + drop the prod volumes (pgdata/redis/minio). schema.sql
# only applies on a FRESH pg volume, so a stale prod volume must be recreated
# after a schema change (greenfield "no migrations" posture — see schema.sql).
#
# ⚠️ THIS DESTROYS THE VERIFICATION INSTANCE. The prod stack is where the real-env audit runs:
# the owner account, the 1009-entry corpus synced from the real vault, the issued access codes,
# the connected SMTP credentials and the job pool all live in these volumes. Wiping them costs
# a full re-claim + re-sync + re-configure, and any live audit round loses its ground truth.
#
# It needs `I_MEAN_IT=yes` because on 2026-08-10 I reached for `prod-fresh` when I wanted
# `prod-up` — the names sit three lines apart, one rebuilds and one destroys, and nothing
# between typing it and losing the instance asked a single question. A comment saying "careful"
# would not have helped: I had already read this file today. The confirmation is the fix
# ([[reframes-tasks-into-enforced-invariants]] — make the mistake impossible, not documented).
prod-clean:
	@test "$(I_MEAN_IT)" = "yes" || ( \
	  echo "prod-clean DESTROYS the prod volumes — the audit instance (owner, corpus, codes, creds)."; \
	  echo "  rebuild the app only ....... make prod-app"; \
	  echo "  rebuild backend + app ...... make prod-up"; \
	  echo "  really wipe it ............. make prod-clean I_MEAN_IT=yes"; \
	  exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml down -v --remove-orphans 2>/dev/null || true

# prod-fresh —— recreate the prod stack from scratch (fresh schema).
# Inherits prod-clean's confirmation: `make prod-fresh I_MEAN_IT=yes`.
prod-fresh: prod-clean prod-up

# release-gc —— after a release round, give back what it occupied.
#
# One `release-push` leaves two things behind, both persistent: the buildx builder used for
# multi-arch builds (a container that in practice sits at nearly 1 GB) and its internal build
# cache. Neither goes away on its own — 42 hours after the last release finished it was still
# sitting there, on a machine that runs other projects at the same time.
#
# **Touches only this repo's own stuff**: stops the standmeet-release builder by name, deletes
# dangling standmeet images by tag. Never touches the global `docker system prune` — that would
# wipe other people's caches too, and this machine is shared across projects (same lesson as
# always: scope it to your own share).
release-gc:
	@docker buildx rm standmeet-release >/dev/null 2>&1 \
	  && echo "  buildx builder standmeet-release removed (rebuilds automatically on next release)" \
	  || echo "  buildx builder standmeet-release not present"
	@n=$$(docker images -f dangling=true -q --filter=reference='ghcr.io/atmaxmoj/standmeet-*' | wc -l | tr -d ' '); \
	  docker images -f dangling=true -q --filter=reference='ghcr.io/atmaxmoj/standmeet-*' \
	    | xargs -r docker rmi >/dev/null 2>&1 || true; \
	  echo "  dangling standmeet images: cleared $$n"
	@echo "[release-gc] cleared only this repo's own build artifacts — other projects' caches untouched"

# release-prune-old —— deletes old-version release images, keeping only the most recent KEEP
# versions + latest.
#
# Why `release-gc` isn't enough: it only clears **dangling** images. Every `release-build` run
# adds a whole tagged batch (5 of them), and a tagged image is never dangling — so none of them
# would ever get cleared this way.
# 18 versions × 5 = 84 images piling up on a machine shared across projects, when only the most
# recent one or two are ever rollback targets.
#
# Scoped to its own share: matches only `ghcr.io/atmaxmoj/standmeet-*`, deletes only the versions
# sorted outside KEEP, `latest` is always kept. Doesn't touch the global prune (same lesson as
# release-gc).
#
# Usage: make release-prune-old        # keeps the most recent 2 versions
#        make release-prune-old KEEP=5
KEEP ?= 2
release-prune-old:
	@set -e; \
	  all=$$(docker images --format '{{.Tag}}' --filter=reference='ghcr.io/atmaxmoj/standmeet-*' \
	    | grep -E '^v[0-9]' | sort -u -V); \
	  n=$$(printf '%s\n' "$$all" | grep -c . || true); \
	  drop=$$(( n - $(KEEP) )); \
	  test "$$drop" -gt 0 || { echo "[release-prune-old] $$n versions, keeping $(KEEP), nothing to delete"; exit 0; }; \
	  old=$$(printf '%s\n' "$$all" | head -n "$$drop"); \
	  for t in $$old; do \
	    docker images --format '{{.Repository}}:{{.Tag}}' \
	      --filter=reference="ghcr.io/atmaxmoj/standmeet-*:$$t" | xargs -r docker rmi >/dev/null 2>&1 || true; \
	    echo "  deleted $$t"; \
	  done; \
	  echo "[release-prune-old] kept the most recent $(KEEP) versions + latest"

# gateway-up —— starts only the llm-gateway sidecar (for eval-smoke), without app-build /
# the whole stack. Anthropic-compat mock, host :9300, deterministic scripted replies.
gateway-up:
	@docker compose -f docker-compose.dev.yml up -d --wait llm-gateway

# eval-smoke —— eval-harness's standalone-invocation smoke test: proves the backend agentic
# core (via the agentcore facade) can be driven by an independent module outside the backend
# process, with a full tool round-trip. Starts llm-gateway → eval-harness/smoke.sh (build +
# queue a deterministic tool+reply + run the binary + assert on the transcript).
eval-smoke: gateway-up
	@eval-harness/smoke.sh

# eval-narration —— F-A-4 eval: a BROAD visitor question against the REAL model (DeepSeek),
# with the REAL corpus tools wired (retrieval plugin over a host socket), fresh fictional
# persona (Dana Rivera). Asserts the model actually GROUNDS the answer (calls the tools) and
# synthesizes — not planning narration, not an ungrounded riff. Real LLM, no mock; skips
# without a key.
#
# The key comes from ~/.config/standmeet/verify-creds.env — the same one home every other real
# credential lives in (verify-shots sources it the same way). It is NOT copied into a repo .env:
# a second copy of a secret is a second place to leak it from, and the harness already reads
# whatever the environment gives it (eval-harness/env.go falls back to a .env only if unset).
eval-narration: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestNarrationLive -count=1 -v ./...

# EVAL_ENV / eval-creds —— load the real provider key into the recipe's environment.
# One home for credentials; the recipe fails loudly if that home is missing, rather than
# skipping the test and reporting a green that never ran the model.
EVAL_ENV = set -a; . $$HOME/.config/standmeet/verify-creds.env; set +a;
eval-creds:
	@test -f $$HOME/.config/standmeet/verify-creds.env || \
	  (echo "missing ~/.config/standmeet/verify-creds.env — the real-env credentials live there"; \
	   exit 2)

# eval-booking-fabrication —— F-A-37 eval: on prod the agent told a visitor a meeting was booked
# while making ZERO tool calls (empty calendar, no card). A mock spec cannot catch that: every
# booking spec FORCES the call through scriptMockToolCall, so the thing that failed — the model's
# own decision to call the tool — is not on trial there. This drives the REAL model through the
# REAL prod loop with the REAL booker plugin (canned calendar behind it) and asserts one thing:
# if the answer says a meeting is booked, the capability store must hold that booking.
# Probabilistic, so drive rounds: EVAL_ROUNDS=20 make eval-booking-fabrication.
eval-booking-fabrication: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestBookingFabricationLive -count=1 -v -timeout 1800s ./...

# eval-slots-restated —— UX-93 eval: the slot card already lays out the time, and the answer's
# body text lists it again (with two different truncation rules, leaving the reader to guess
# which one is real). **A mock can't drive this**: the body text is written by the model itself,
# and the mock LLM only returns the exact line a test registered — the culprit never shows up.
# So, same as F-A-37, this goes through the real model + real booker.
# The check counts distinct times mentioned (at most one per turn on the slot card), not "feels
# repetitive."
# Probabilistic, drive several rounds: EVAL_ROUNDS=5 make eval-slots-restated.
# eval-owner-identity —— UX-66 eval: after the public slice was narrowed, the owner's AI told a
# stranger it doesn't know the owner. The corpus **deliberately excludes** any note that
# introduces the owner (real prod's public slice is exactly like this); the check is a single
# claim: it must not deny knowing that person. Declining to book, or saying there's no calendar,
# are both fine — those are correct answers.
# EVAL_ROUNDS=3 make eval-owner-identity.
eval-owner-identity: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestOwnerIdentityLive -count=1 -v -timeout 1800s ./...

eval-slots-restated: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestSlotsRestatedLive -count=1 -v -timeout 1800s ./...

# eval-ask —— feeds one question to the agent under test (owner persona), watches how it
# answers + which corpus it checked. The subject under test = the owner's system prompt +
# corpus, real LLM (DeepSeek v4-pro, harness reads its own .env). The interviewer isn't part of
# this — the interviewer is a Claude agent the operator spawns, which repeatedly calls this
# --ask to drive a multi-turn interview + judge grounding against the corpus.
#   echo '{"history":[],"question":"..."}' | make eval-ask
eval-ask:
	@cd eval-harness && go build -o /tmp/eval-harness . && \
	  /tmp/eval-harness --ask --persona fixtures/personas/marcus-chen

# eval-ghost —— Ghost steering judgment, deterministic eval: inject each ghost scenario's
# waypoints into the frozen RoleSnapshot, run the SAME prod loop via the agentcore facade,
# assert the emitted ghost hits gold (target_waypoint / silence). Steering judgment = the
# `assert` half; voice/coherence = `human` (read the transcript). Runs on the mock gateway
# (deterministic), no real LLM.
eval-ghost: gateway-up
	@eval-harness/ghost-test.sh

# eval-compaction —— multi-turn context-bloat case, **two legs**:
#   conv  —— a >32K-token long conversation; asserts compaction actually triggers, and that
#            recall of early **conversation facts** stays intact after compaction
#   tools —— history stays under the threshold, lets tools run first, then a large report
#            pushes the context over the line; asserts compaction lands after the tools, that
#            turn can still answer with a number only a tool ever returned, and **zero tool
#            calls happened after compaction**
#            (F-D-10: re-reading it can also produce the right answer, so scoring the answer
#            alone can't distinguish whether the summary carried the substance forward)
# **Needs a real LLM** (harness reads eval-harness/.env's DeepSeek key; compaction never
# triggers without a real key).
eval-compaction:
	@eval-harness/compaction-test.sh

# eval-doc-context —— #36 position-awareness / anaphora-resolution case: a visitor is reading
# the Notification Pipeline article and asks "tell me more about this pipeline" (the corpus has
# two pipelines, genuinely ambiguous). doc_context → real instructionWithDoc injection → asserts
# the real model resolves "this" to the current doc (answers about Orbit notifications:
# token-bucket/fan-out), doesn't drift into FlowPay reconciliation, and doesn't ask back.
# **Needs a real LLM** (harness reads eval-harness/.env's DeepSeek key; the mock gateway doesn't
# do anaphora resolution and would fail this).
eval-doc-context:
	@eval-harness/doc-context-test.sh

# eval-cross-conversation —— the "cross-thread" case: one member has multiple separate
# conversations, and the AI can read that member's entire conversation history. Verifies
# reference quality in both directions: something said in chat can be referenced under the wiki
# flyover, and vice versa. Two "other conversation" snippets get injected into the instruction
# (mirroring the real backend injection) → checks whether the real model connects them across
# conversations + answers honestly/grounded.
# **Needs a real LLM** (harness reads eval-harness/.env's DeepSeek key; running it against the
# mock gateway would be wasted effort).
eval-cross-conversation:
	@eval-harness/cross-conversation-test.sh

# eval-subjectivity —— quality case: SUBJECTIVITY is subject-HOOD — being a SUBJECT (a first-person "I"
# judging FROM a lived standpoint), not an OBJECT (a person described from outside by attributes). Far
# more than tone, and more than a rich attribute list. Discriminative: same corpus + same question,
# three runs — subjectivity A (an outage), B (academia→a dropout shipping), and a no-subjectivity
# baseline (the OBJECT floor). A and B are built to reach OPPOSITE ship-timing conclusions; the judge
# reads the spine — does the persona speak AS the subject (first-person, from inside) or RECITE the
# person's attributes — plus divergent judgment, beyond-tone, and baseline contrast. Two failure modes:
# tone-collapse (costume) and the deeper object-collapse (a fluent narration ABOUT a person that never
# speaks AS one). **Needs a real LLM** (eval-harness/.env).
eval-subjectivity:
	@eval-harness/subjectivity-test.sh

# eval-interview —— actually runs a multi-turn interview (recruiter on a code session, booking
# granted), annotating each turn by dimension as it goes: grounding / context retention /
# honest gap / not-in-corpus / privacy / tool use. Surfaces which corpus each turn's agent read +
# its answer + ghost hint, for a human/judge agent to grade quality and probe for prompt cracks
# to feed back in. **Needs a real LLM** (eval-harness/.env DeepSeek key).
#   make eval-interview            # defaults to marcus-chen
#   EVAL_PERSONA=<dir> make eval-interview
eval-interview:
	@cd eval-harness && go build -o eval-harness-bin . && \
	  python3 interview.py

# eval-summary —— end-to-end eval of summarize_conversation on REAL DeepSeek. A
# recruiter drills into ONE point over several turns, asks for a written summary
# (captures the report HTML), then keeps asking follow-ups (which also guard the
# empty-assistant-message history bug — a post-summarize turn must still answer).
# An LLM judge scores the report; report HTML + a styled doc land in
# /tmp/sm-eval-summary for a human to open. **Needs a real LLM** (eval-harness/.env key).
#   make eval-summary
#   EVAL_SUMMARY_DRILL=6 EVAL_SUMMARY_FOLLOWUPS=3 make eval-summary
eval-summary:
	@cd eval-harness && go build -o eval-harness-bin . && \
	  python3 summary.py

# eval-capabilities —— the standing agentic-capability suite. The assert class (was
# booking/skill/mcp actually called; deny is structurally absent; did a privacy canary leak;
# is there a ghost hint) is a hard PASS/FAIL; the human class (grounding/honesty/ambiguity/
# prompt injection/ghost quality/booking failure) finishes leaving a transcript + a "LOOK FOR"
# note for a human/judge to read. The mcp case auto-starts mock-stack/mcp; if it can't come up,
# it SKIPs (never silently).
# **Needs a real LLM** (eval-harness/.env DeepSeek key).
#   make eval-capabilities
#   EVAL_CASES=booking,skill,mcp make eval-capabilities   # subset
eval-capabilities:
	@cd eval-harness && go build -o eval-harness-bin . && \
	  python3 capabilities.py

# eval-owner-mcp —— drives the agent against the OWNER-side MCP server (the inbound/ingest
# half, the counterpart of the visitor's outbound side). Goes through the real
# @standmeet/mcp-client Sigv1 stdio bridge, runs the me → raw_dump → list_recent_raw →
# promote_to_wiki → list_recent_wiki loop, mechanical round-trip assertions.
# Needs the dev stack up + claimed. Defaults to the demo owner (marcus, claimed by
# reseed-marcus); override with OWNER_EMAIL=... for other instances. Auto-mints a temporary
# keypair, discarded when done. Note: this writes one raw+wiki eval entry into the corpus; run
# reseed-marcus.sh afterward to reset back to 50.
eval-owner-mcp:
	@OWNER_EMAIL="$${OWNER_EMAIL:-marcus@local.test}" eval-harness/owner-mcp-setup.sh

# verify-round —— starts one round of real-env manual verification. Creates a directory named
# by its start time: e2e/manual-runs/<UTC timestamp>/{runsheet.md, trajectory/<module>.md,
# shots/}.
# The runsheet is generated from docs/real-env-verification/items/ (never hand-copied — a new
# module shows up automatically next round); the whole directory is gitignored — it's evidence
# of one run, not documentation about the product. SOP lives in
# docs/real-env-verification/sop.md §0.
#   make verify-round
verify-round:
	@infra/scripts/verify-round

# verify-shots —— the **screenshot driver** for step ⑤ of manual verification: opens a real
# browser, logs in / clicks / types / screenshots per the plan, drops images into that round's
# trajectory directory. Judged by looking at the images, not the DOM text.
#
# Why it exists: step ⑤ used to rely on the browser MCP driving it, and MCP disconnects (once
# with nothing left but a Chrome running on **a different machine**, unreachable from local
# port 38227). The driver can be swapped; the environment cannot — it's driving **prod**, real
# vault, real corpus, real provider.
#
# **It never touches data**: only logs in, navigates, screenshots — never writes a single line.
# Don't confuse it with e2e — e2e hits dev and every spec resets the instance, and doing that on
# prod would wipe the real corpus.
#
# **Credentials come from two homes, each with its own owner**: `~/.config/standmeet/verify-creds.env`
# is the home for verification credentials; the **inference key** belongs to eval-harness
# (`eval-harness/.env`'s `EVAL_KEY`, which is what it uses to run the real model). verify-creds
# leaves only one line pointing to it — a secret copied to two places is two places you have to
# rotate it. The gate's BYOAI cell needs exactly "a visitor pastes their own key into the form",
# so the driver reads both in, and the plan file only names the variable
# (see shoot.mjs's `typeSecret`). It doesn't error when eval-harness/.env is missing: most plans
# don't need it.
#
#   make verify-shots PLAN=e2e/manual/plans/seo.json
# turn-hop-probe —— forces out the failure path of the /api/v1/agent/turn hop (F-O-3): stop
# backend → fire one cross-origin request → assert 502 + a human-readable message + **with CORS
# headers** → bring backend back. One spec can't do this: it needs "app alive, backend
# unreachable" as its precondition, and stopping the shared backend mid-suite would take out
# every other spec with it.
#
#   make turn-hop-probe              # dev
#   make turn-hop-probe STACK=prod   # prod
turn-hop-probe:
	@STACK=$(STACK) e2e/manual/turn-hop-failure-probe.sh

verify-shots:
	@test -n "$(PLAN)" || (echo 'usage: make verify-shots PLAN=e2e/manual/plans/<name>.json'; exit 2)
	@set -a; . $$HOME/.config/standmeet/verify-creds.env; \
	  [ -f eval-harness/.env ] && . ./eval-harness/.env; set +a; \
	  cd e2e && node manual/shoot.mjs "../$(PLAN)"

# verify-mcp —— drives prod through the owner's MCP path. **The sibling of verify-shots**: that
# one goes through the UI; this one goes through the same path the owner uses inside Claude —
# several checks' Expected column asks for "read the tool's own receipt", which the admin panel
# has no way to produce (which sections page.unpin touched, custom_page's lifecycle, how many
# entries jobs.fetch_new pulled back).
#
# **Never hand-roll a Sigv1 signer**: it starts the **product's own** stdio client
# (`sdk/packages/mcp-client/bin`) — the same binary, same environment variables the owner
# configures in Claude Desktop. Bypassing it to sign requests yourself means you're no longer
# testing the product's actual path ([[c3-stdio-sdk-sigv1-401]]).
#
# Credentials: mint a keypair in the GUI → download the .pem → `downloads/build-creds.sh <pem>
# <key-id>` assembles credentials.json. **You must revoke the keypair in the GUI and delete the
# local private key when done.**
#
#   make verify-mcp CREDS=e2e/manual-runs/<round>/downloads/credentials.json \
#     CALLS='[{"name":"page.pin","args":{"section":"insights","entry_id":"…"}}]'
#
# CALLS_FILE= is another entry point for the same thing: the payload is read from a file.
# **A real note's body text can't survive the command line** — it has newlines, single quotes,
# frontmatter's `---`, and stuffing it into `'$(CALLS)'` either gets truncated by the shell or
# has its quotes eaten. Use this path whenever you need to send a real note's body back verbatim
# (e.g. verifying "does editing the body accidentally wipe other fields").
verify-mcp:
	@test -n "$(CREDS)" || (echo 'usage: make verify-mcp CREDS=<credentials.json> CALLS=<json array>|CALLS_FILE=<path>'; exit 2)
	@# CALLS is wrapped in **single quotes**: it's a JSON blob, all double quotes inside, and its
	@# values may contain spaces. With double quotes, `test` receives a list of words instead of one
	@# argument when a value has a space, and reports "too many arguments" — which looks like a usage
	@# error but is actually a quoting error.
	@test -n '$(CALLS)' -o -n "$(CALLS_FILE)" || (echo 'usage: make verify-mcp CREDS=<credentials.json> CALLS=<json array>|CALLS_FILE=<path>'; exit 2)
	@if [ -n "$(CALLS_FILE)" ]; then \
	  node e2e/manual/mcp-drive.mjs sdk/packages/mcp-client/bin/standmeet-mcp \
	    "$${STANDMEET_VERIFY_HOST:-http://localhost:38227}" "$(CREDS)" "$$(cat $(CALLS_FILE))"; \
	else \
	  node e2e/manual/mcp-drive.mjs sdk/packages/mcp-client/bin/standmeet-mcp \
	    "$${STANDMEET_VERIFY_HOST:-http://localhost:38227}" "$(CREDS)" '$(CALLS)'; \
	fi

# schema-drift —— asks the running database: for every table/column schema.sql declares, do you
# actually have it. schema.sql is applied by postgres only **once, on a fresh volume**, so a
# long-lived instance stays frozen at the shape it was born with — a column added later exists
# only in the file, and the backend keeps running fine until some UI query finally hits it and
# blows up. Run this before starting an audit round.
#   make schema-drift            # prod
#   STACK=dev make schema-drift  # dev
schema-drift:
	@infra/scripts/schema-drift

# i18n-keys —— every t('key') must resolve within its namespace. A missing message is not a
# build error: it renders the raw key path straight to the owner (F-L-15: /admin/subjectivity
# had 17 lines all reading ADMINCORPUS.COMMON.EDIT). The repo's existing i18n lint checks the
# opposite direction (hardcoded strings that should be keys), and e2e clicking that button also
# passes — the button is there and clickable, only the text is a raw key.
#   make i18n-keys
i18n-keys:
	@infra/scripts/check-i18n-keys

# verify-items —— an audit item is a **test description**, never a status record. Run status
# lives in that round's runsheet; defect status lives in findings.md. Two ledgers will always
# drift apart, and "not done" is exactly as unreliable as "done."
# The gate carries its own self-test (a planted violation must be caught), because a blinded
# scanner would otherwise just report "all clear."
verify-items:
	@infra/scripts/check-verify-items --self-test >/dev/null
	@infra/scripts/check-verify-items

# dev-rebuild —— after changing backend / app code, force rebuild + recreate the given service,
# leaving db/redis/minio untouched (keeps data). Usage: make dev-rebuild SVC=app
dev-rebuild: app-build
	@test -n "$(SVC)" || (echo "usage: make dev-rebuild SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml up -d --build --wait --force-recreate --no-deps $(SVC)

dev-down:
	@docker compose -f docker-compose.dev.yml down --remove-orphans

# dev-fresh —— down + drop dev's pg volume + start fresh. **Use only when you need a truly clean slate.**
#
# Schema changes no longer need this: write a `backend/db/migrations/*.sql` and
# `make dev-rebuild SVC=backend` applies it (the backend applies it on its own at startup). dev
# now goes through the same upgrade path as prod — which matters, because when "dev relies on
# dropping the volume, prod relies on hand-applying SQL", dev's green never actually exercised
# prod's path.
#
# Unlike prod-clean, this one **doesn't require** I_MEAN_IT: dev's data is inherently disposable
# (every spec resets the instance itself), while prod's volumes hold real corpus and real
# credentials. The two commands are dangerous by orders of magnitude apart — they shouldn't
# share the same threshold; a confirmation everyone learns to click through is worse than no
# confirmation at all.
dev-fresh:
	@docker compose -f docker-compose.dev.yml down --remove-orphans -v
	@$(MAKE) dev-up

# meili-stop / meili-start —— manually stop/start meilisearch, for the retrieval-degrade e2e
# to verify degradation + self-healing.
# (e2e runs workers:1 serially; the degrade spec guarantees a restart in afterAll, so other
# specs aren't affected.)
meili-stop:
	@docker compose -f docker-compose.dev.yml stop meilisearch

meili-start:
	@docker compose -f docker-compose.dev.yml up -d --wait meilisearch

# dev-stop-svc —— stop **one** service in the stack (for fault injection). Usage: make
# dev-stop-svc SVC=mailpit
# Example: verifying that e2e's ensureStackUp really brings a container back up when it goes
# down — a check that only ever says "OK" is no check at all.
# Bring it back with make dev-up (or any spec's resetInstance).
dev-stop-svc:
	@test -n "$(SVC)" || (echo "usage: make dev-stop-svc SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev stop $(SVC)

# dev-restart-svc —— restart **one** service in the stack. Usage: make dev-restart-svc SVC=backend
# Example: something that only runs once at process startup (a periodic task's first run happens
# at boot) — testing it needs the process to start over.
# dev-pgsearch-on / -off —— makes dev **simulate a search-engine degradation** (pull Meili out,
# fall back to Postgres full-text) and then restore it.
#
# Why it exists: corpus-search's check 4 needs to drive "what happens when the search engine is
# gone", and before this there was no way to reach the degraded path at all — every search e2e
# only ever exercised the Meili half.
#
# **Don't read this as "switching to prod's path."** By design, `corpus_search` is the tool that
# goes through Meili; prod compose having no meilisearch is an accident (F-S-3), not intent.
#
# **Once you switch, what "green" means has changed.** Any conclusion drawn from running it here
# needs to say which path it ran on, or the next person will treat two different sets of
# assertions as the same thing.
dev-pgsearch-on:
	@docker compose -f docker-compose.dev.yml -f docker-compose.pgsearch.yml \
		-p standmeet-dev up -d --wait --force-recreate backend
	@echo "[dev] search path = Postgres full text (prod's default). MEILI_URL blanked."

dev-pgsearch-off:
	@docker compose -f docker-compose.dev.yml -p standmeet-dev \
		up -d --wait --force-recreate backend
	@echo "[dev] search path = meilisearch (dev default)."

dev-restart-svc:
	@test -n "$(SVC)" || (echo "usage: make dev-restart-svc SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev restart $(SVC)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev up -d --wait $(SVC)

# dev-logs —— tail a service's logs (for diagnosis). Usage: make dev-logs SVC=backend N=80
dev-logs:
	@test -n "$(SVC)" || (echo "usage: make dev-logs SVC=<service> [N=<lines>]"; exit 2)
	@docker compose -f docker-compose.dev.yml logs --tail=$(if $(N),$(N),60) $(SVC)

# prod-logs —— same as above, but against the real-env stack (when a real-env audit's manual
# drive goes wrong, reading its logs is the first step).
# Usage: make prod-logs SVC=backend N=80
prod-logs:
	@test -n "$(SVC)" || (echo "usage: make prod-logs SVC=<service> [N=<lines>]"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml logs \
		--tail=$(if $(N),$(N),60) $(SVC)

build:
	@echo "[build] not implemented yet."

# sqlc-gen —— regenerate Go query bindings from db/queries/*.sql + db/schema.sql.
# Pinned to v1.20.0 inside the official sqlc docker image. Newer sqlc (1.31+)
# changed initialism handling (AIProvider → AiProvider), which is a non-trivial
# rename across owners.sql.go / page_content.sql.go etc — upgrade is a
# separate PR. Until then this target is the only sanctioned way to regen
# dbq locally (host installs may pull a newer version).
#
# After running, diff backend/internal/postgres/dbq/ and commit the new files.
sqlc-gen:
	@docker run --rm \
		-v $(PWD)/backend:/src \
		-w /src \
		sqlc/sqlc:1.20.0 generate
	@echo "[sqlc] regenerated. diff & commit backend/internal/postgres/dbq/"

# test —— one command to run the full e2e suite: dev-up first (SDK build → app build →
# docker compose --build --wait, incremental rebuild of whatever changed), then playwright.
# In-conversation e2e is one command, `make test` — don't split it into steps.
# test —— full run. **Automatically archives failure evidence when finished** (see
# archive-failures): playwright's test-results/ gets fully overwritten by the next
# `make test-only` run, and the first thing you do when fixing a bug is run a single spec —
# so the full-run evidence gets wiped out one second before you need it, leaving only a re-run
# to fall back on, and the SOP explicitly calls a re-run the worse option.
# Archiving is automatic: relying on "remember to back it up first" is the same as not having it.
# `--project=chromium` has to be spelled out: the config has two projects (desktop + mobile
# viewport), and playwright runs **both** if you don't specify one. Without it, `make test`
# takes twice as long, and the mobile run's reds get mixed into the full-suite's judgment —
# that's a separate front with its own entry point (test-mobile).
test: dev-up
	@infra/scripts/machine-witness.sh & w=$$!; \
		cd e2e && pnpm exec playwright test --project=chromium; st=$$?; cd ..; \
		kill $$w 2>/dev/null; $(MAKE) archive-failures; exit $$st

# mobile-shots —— one screenshot per surface at 390×844, produced for a human to look at,
# **not** a functional test.
# GREP=admin drives only the admin group. Images land in e2e/manual-runs/mobile-sweep/, same
# filenames overwritten each time, so re-running after an edit gives you a direct before/after
# comparison at the same filename.
mobile-shots: dev-up
	@cd e2e && pnpm exec playwright test --project=mobile $(if $(GREP),-g "$(GREP)")
	@echo "[mobile] $$(ls e2e/manual-runs/mobile-sweep/*.png 2>/dev/null | wc -l | tr -d ' ') images → e2e/manual-runs/mobile-sweep/"

# mobile-shots-asis —— same as above, but no rebuild, no up — hits whatever stack is already
# running. Use this in a CSS-tweak loop.
mobile-shots-asis:
	@docker compose -f docker-compose.dev.yml ps --status running --quiet backend | grep -q . \
		|| (echo "[mobile-shots-asis] dev backend is not running — run 'make dev-up' first"; exit 2)
	@cd e2e && pnpm exec playwright test --project=mobile $(if $(GREP),-g "$(GREP)")
	@echo "[mobile] $$(ls e2e/manual-runs/mobile-sweep/*.png 2>/dev/null | wc -l | tr -d ' ') images → e2e/manual-runs/mobile-sweep/"

# archive-failures —— copies this run's failure evidence into
# e2e/test-results-archive/<UTC timestamp>/.
# Does nothing if there were no failures. The archive directory is timestamped, so successive
# full runs never overwrite each other.
archive-failures:
	@test -d e2e/test-results/playwright || exit 0
	@ls e2e/test-results/playwright 2>/dev/null | grep -q . || exit 0
	@d="e2e/test-results-archive/$$(date -u +%Y%m%dT%H%M%SZ)"; \
		mkdir -p "$$d" && cp -R e2e/test-results/playwright "$$d"/ && \
		docker logs standmeet-dev-backend-1 > "$$d/backend.log" 2>&1 || true; \
		echo "[archive] failure artifacts → $$d/playwright ($$(ls e2e/test-results/playwright | wc -l | tr -d ' ') case dirs) + backend.log"

# test-fresh —— same as test, but cleans first (down -v) so the db volume rebuilds and
# reapplies from schema.sql. Use this when schema.sql has changed; pure code changes should
# use `make test`.
test-fresh: clean test

# test-only —— run just one spec / one grep pattern. For isolating a reproducer.
# REPEAT=N —— run this spec N times (--repeat-each), for catching an intermittent flake.
# usage:   make test-only SPEC=blog-posts
#          make test-only SPEC=blog-posts GREP="MCP post_create"
#          make test-only SPEC=visitor-ask-visitor REPEAT=15
# Archiving is wired up on test-only too: playwright's test-results/ gets wiped by the **next**
# run, and the next run is usually the same test-only command you typed to fix the first
# failure — so the rest of the failure evidence would delete itself one second before you need
# it. `make test` archiving alone isn't enough: batch verification produces failures that need
# to be preserved just as much.
test-only: dev-up
	@test -n "$(SPEC)" || (echo "usage: make test-only SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT)); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# test-asis —— run a spec against **whatever is already running**, no rebuild, no `up`.
#
# This is the ③🧪 recipe from the audit SOP: a new guard must go RED on the UNFIXED code
# before the fix lands. `test-only` depends on `dev-up`, which rebuilds the backend — so it
# builds the fix you just wrote and the guard is green the first time you ever run it. A
# guard whose red was never observed proves nothing ([[assertion-that-cannot-fail]]).
#
# Write the guard, run it here (the containers still hold the old binary) → see the red,
# then `make test-only SPEC=<same>` to rebuild with the fix and see it go green.
#
#   make test-asis SPEC=job-pool-stays-visible
#   make test-asis SPEC=job-pool-stays-visible REPEAT=5
#
# REPEAT is honoured here too. It used to be accepted and silently dropped — you would ask for
# five runs of a suspected flake, get one, and read the pass as five. A recipe that takes a
# variable it does not use reports success for work it never did.
test-asis:
	@test -n "$(SPEC)" || (echo "usage: make test-asis SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@docker compose -f docker-compose.dev.yml ps --status running --quiet backend | grep -q . \
		|| (echo "[test-asis] dev backend is not running — run 'make dev-up' first"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT)); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# test-captcha —— bring the dev stack up WITH captcha on, using Cloudflare's published test keys,
# and run the captcha specs against it.
#
# Every other spec runs with captcha off (the vars are empty by default), which is the shipped
# default and what the rest of the suite should exercise. But "off everywhere" is why the visitor
# captcha surfaces were never driven at all: the widget only renders when the instance publishes a
# site key (F-G-3).
#
# The keys below are Cloudflare's own always-pass pair, published for exactly this. The widget
# self-issues a token — there is no challenge being defeated, which is the whole point of a vendor
# test mode. Real challenges stay off limits.
#
#   1x00000000000000000000AA          sitekey, always passes
#   1x0000000000000000000000000000000AA  secret, always validates
#
# Only the `captcha-on-*` specs run here, and the prefix is load-bearing: with the always-pass
# secret the provider validates ANY token, so `security-captcha-bypass` — which asserts a forged
# token is refused — fails on this stack for a reason that is not a defect. That spec belongs to
# the captcha-OFF default suite. A greedy `captcha` glob pulled it in once and produced exactly
# that false red.
#
# The stack is left running with captcha ON — `make dev-up` puts it back.
test-captcha:
	@TURNSTILE_SITE_KEY=1x00000000000000000000AA \
	 TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
	 $(MAKE) dev-up
	@cd e2e && pnpm exec playwright test $(if $(SPEC),$(SPEC),captcha-on-); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# test-boundary —— shortens the turn's time wall **and the rescue attempt right after it**, to
# drive the boundary-case use cases.
#
# Why it needs its own bench: both budgets are process-level (300s / 60s). There's no way to
# shorten them for just one test case within the default suite, which is why "what does the
# product say once it hits the wall" **has never been driven at all** — when it actually
# happened on prod, the visitor read "connection interrupted, ask again" (F-A-44).
#
# Both need to be short: shortening only the turn budget means the 60-second rescue saves it (a
# good path, with its own test case); what needs driving here is the cell where **even the
# rescue doesn't arrive in time**. BOUNDARY_TIGHT is also passed to the test process, so the
# case can skip itself based on it, keeping it from ending up as a permanent red inside the
# default suite (the lesson from those five captcha cases).
#
# The bench runs on a short budget — `make dev-up` restores it afterward.
test-boundary:
	@AGENT_TURN_TIMEOUT=5 FORCE_FINAL_TIMEOUT=3 $(MAKE) dev-up
	@cd e2e && BOUNDARY_TIGHT=1 pnpm exec playwright test $(if $(SPEC),$(SPEC),agent-turn-deadline); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# test-red —— run one spec against the images that are ALREADY RUNNING. No dev-up, no rebuild.
#
# This exists for one step of the fix SOP: proving a new test actually fails on the buggy code.
# `test-only` depends on dev-up, so by the time it runs, the fix sitting in the working tree has
# been built into the images — a test written and run after the fix can only ever be seen green,
# and a test that cannot go red says nothing. Run this BEFORE rebuilding to watch it fail, then
# `make test-only` to watch the same test pass.
#
# The stack must already be up (this target deliberately does not bring it up: bringing it up is
# what would rebuild it). usage: make test-red SPEC=test/foo.spec.ts [GREP=...] [REPEAT=N]
test-red:
	@test -n "$(SPEC)" || (echo "usage: make test-red SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev ps --status running --quiet backend \
		| grep -q . || (echo "test-red: dev stack is not running — start it with 'make dev-up' (that rebuilds)"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT)); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# dev-app —— rebuild ONLY the dev app image (frontend-only change) and reuse the running
# backend/mocks. Use when a fix is app-only and a full dev-up (which also rebuilds backend) is
# unnecessary or blocked (e.g. an unrelated uncommitted backend WIP failing `make lint`). The
# rest of the stack must already be up.
dev-app: app-build
	@docker compose -f docker-compose.dev.yml build app
	@docker compose -f docker-compose.dev.yml up -d --wait app
	@echo "[dev] app rebuilt (backend + mocks reused)"

# test-run —— run a spec WITHOUT the dev-up rebuild (assumes the stack is already up). Pair with
# dev-app for an app-only change, or when dev-up's backend rebuild is unnecessary/blocked.
test-run:
	@test -n "$(SPEC)" || (echo "usage: make test-run SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT))

# test-unit —— fast headless unit tests for reusable render/toolbox primitives (vitest, no Docker,
# no browser). Scoped to pure framework-shaped units — e.g. the markdown→HTML render pipeline where
# the bug lives in the pipeline, not a full-stack flow (F-R-3: sanitize must run before katex). The
# e2e suite stays the primary coverage; this is the guard for things e2e structurally can't pin.
test-unit:
	@cd app && pnpm run test:unit

# gui-p1-variant —— F-A-4 P1 presentation-variant probe: drive the REAL prod GUI (real
# DeepSeek) through one broad-question visitor turn, screenshot narration/tools/done/reload
# moments into /tmp/p1-variants/<VARIANT>-*.png + a JSON summary. Prod stack must be up.
# usage: make gui-p1-variant VARIANT=iii-status-quo [CODE=FA5-001]
gui-p1-variant:
	@test -n "$(VARIANT)" || (echo "usage: make gui-p1-variant VARIANT=<name> [CODE=...]"; exit 2)
	@cd e2e && VARIANT=$(VARIANT) $(if $(CODE),CODE=$(CODE)) pnpm exec node scripts/p1-variant-drive.mjs

# test-headed —— same as test-only, but --headed opens a real browser for visual observation
# (single worker, one spec at a time). The reading-dom case carries [[slow-final:2500]], so the
# throbber holds for 2.5s and stays legible.
test-headed: dev-up
	@test -n "$(SPEC)" || (echo "usage: make test-headed SPEC=<spec-name> [GREP=<title pattern>]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) --headed --workers=1 $(if $(GREP),-g "$(GREP)")

# setup-token —— during a demo, the owner opens / gets auto-redirected to /setup?t=...; this
# target just prints the path for the operator to copy (the boot banner already printed it once,
# but later logs may have scrolled it away). e2e doesn't need this — fixtures/instance.findSetupToken
# already goes through the same /api/v1/instance fetch.
setup-token:
	@curl -sS http://localhost:8000/api/v1/instance | jq -r '"setup path: /setup?t=" + .setup_token'

# password-reset —— emergency fallback for an owner who forgot their password. docker exec runs
# the standmeet binary's password-reset subcommand: connects to DB → issues a one-time reset
# token → prints plaintext + URL to stdout. 30min TTL, one-time use. Owner pastes the URL into a
# browser to change their password.
password-reset:
	@docker compose -f docker-compose.dev.yml exec backend /app/standmeet password-reset

clean:
	@docker compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true

# capture-marketplace-fixtures —— refresh the GitHub anthropics/skills
# snapshot. SkillsMP is hand-rolled (no real upstream); see
# e2e/fixtures/marketplace/README.md.
capture-marketplace-fixtures:
	@bash e2e/fixtures/marketplace/capture.sh

# trim-marketplace-fixtures —— write captured .raw/ into the committed
# fixture path (drops fields we don't read).
trim-marketplace-fixtures:
	@bash e2e/fixtures/marketplace/trim.sh

# capture-job-fixtures / trim-job-fixtures —— the job-board equivalents of the two
# above.  Both scripts have existed since the job loop landed and three docs told
# readers to run them "via make", but the recipes were never added — so the only
# way to refresh a fixture was to bypass the house rule and run the script bare.
# capture hits the real boards (rate limits: quarterly, per docs/design/job-loop-tests.md T.9),
# so both take KIND= to refresh a single board:  make capture-job-fixtures KIND=remoteok
capture-job-fixtures:
	@KIND="$(KIND)" bash e2e/fixtures/job-boards/capture.sh

trim-job-fixtures:
	@KIND="$(KIND)" bash e2e/fixtures/job-boards/trim.sh

# backup / restore —— disaster recovery for a self-hosted instance.
#   make backup DEST=/var/backups/standmeet
#   make restore TARBALL=/var/backups/standmeet/standmeet-20260819-101500.tar.gz
# restore is destructive (docker compose down -v wipes the volumes first), so it
# refuses to start without an explicit TARBALL rather than defaulting to anything.
backup:
	@bash infra/scripts/backup.sh "$(or $(DEST),./backups)"

restore:
	@test -n "$(TARBALL)" || { echo "usage: make restore TARBALL=/path/to/standmeet-*.tar.gz"; exit 2; }
	@bash infra/scripts/restore.sh "$(TARBALL)"

# prod-psql —— run SQL against the prod DB.  usage: make prod-psql SQL="select 1"
#
# schema.sql is applied by postgres ONLY on a fresh volume (see docker-compose.prod.yml), so an
# instance that predates a new table never gets it — the backend just 500s on that route forever.
# This is the escape hatch for the verification stack; it is NOT an upgrade story for real
# self-hosted owners (see F-A-16).
prod-psql:
	@test -n "$(SQL)" || (echo 'usage: make prod-psql SQL="select 1"'; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 -c "$(SQL)"

# prod-redis —— run a redis command against the prod redis.  usage: make prod-redis CMD="info memory"
#
# The same kind of verification-stack escape hatch as prod-psql. resilience's check 1 needs the
# **real state** of "there's a cap, it's been hit, eviction has started", and that can only be
# produced on a live redis: lower maxmemory → fill it → read evicted_keys → set it back.
# Not an owner-facing feature.
prod-redis:
	@test -n "$(CMD)" || (echo 'usage: make prod-redis CMD="info memory"'; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis redis-cli $(CMD)

# prod-redis-fill —— fills prod redis with KEYS 300-byte keys, **each with a 600-second TTL**
# (no cleanup needed when done — they expire on their own). Produces the real "at capacity +
# actively evicting" state resilience check 1 needs; pair with a temporarily lowered
# REDIS_MAXMEMORY in .env. The Lua is written inline rather than passed via CMD: nested quotes
# don't survive the shell.
#
#   make prod-redis-fill KEYS=8000
prod-redis-fill:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis redis-cli eval \
	 "for i=1,tonumber(ARGV[1]) do redis.call('SETEX','verifyfill:'..i,600,string.rep('x',300)) end return redis.call('dbsize')" \
	 0 $(or $(KEYS),8000)

# prod-gate-unlock —— clear the gate's per-IP lockouts on prod.
#
# Driving a lockout by hand (F-G-3's ⑤, F-G-4's ⑤) really locks the gate for fifteen minutes, and
# on a stack with no proxy setting X-Forwarded-For the bucket is `unknown-source` — ONE bucket that
# every visitor shares (F-F-5). So a verification run would lock the door for everyone until the
# TTL runs out. This puts it back immediately.
#
# EVERY per-IP tally, because they lock independently: `codefail:ip:` counts invalid codes,
# `requestflood:ip:` counts notes, `ratelimit:login:` counts login attempts. Clearing only the
# first left the note door shut with nothing on screen to say so — the escape hatch has to know
# about every bucket the mechanism grew (`middleware/ip_tally.go` + `login_guard.go` are where
# they are configured). Add the pattern here in the same commit that adds a tally.
#
# It is a verification-stack escape hatch, not an owner feature: an owner who wants to lift a lock
# solves the captcha, which is the whole point of the surface this exists to test.
GATE_LOCK_PATTERNS = 'codefail:ip:*' 'requestflood:ip:*' 'ratelimit:login:*'
prod-gate-unlock:
	@for p in $(GATE_LOCK_PATTERNS); do \
		docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis \
			redis-cli --scan --pattern "$$p" | xargs -r docker compose -p standmeet-prod \
			-f docker-compose.prod.yml exec -T redis redis-cli DEL; \
	done
	@echo "[prod] per-IP lockouts cleared (invalid codes + note flood + login attempts)"

# prod-psql-file —— same, for multi-line SQL.  usage: make prod-psql-file FILE=/tmp/x.sql
prod-psql-file:
	@test -f "$(FILE)" || (echo 'usage: make prod-psql-file FILE=<path.sql>'; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 < "$(FILE)"

# dev-psql —— run SQL against the DEV DB.  usage: make dev-psql SQL="select 1"
# For validating hand-written queries (stats_activity / stats_growth bypass sqlc) against real schema.
dev-psql:
	@test -n "$(SQL)" || (echo 'usage: make dev-psql SQL="select 1"'; exit 2)
	@docker compose -p standmeet-dev -f docker-compose.dev.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 -c "$(SQL)"

# dev-psql-file —— same, for multi-line SQL.  usage: make dev-psql-file FILE=/tmp/x.sql
# The one-liner form goes through the shell twice, so a `$` inside the SQL (a regex anchor, say)
# arrives mangled and postgres reports a syntax error in a statement you did not write.
dev-psql-file:
	@test -f "$(FILE)" || (echo 'usage: make dev-psql-file FILE=<path.sql>'; exit 2)
	@docker compose -p standmeet-dev -f docker-compose.dev.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 < "$(FILE)"

# docker-gc —— reclaim buildkit cache + dangling images. Safe: never touches running containers,
# named volumes (pgdata/redis/minio), or tagged images in use. Run when the Docker VM disk fills from
# many rebuilds (symptom: `docker system df` hangs, builds crawl).
#
# NOTE: prunes only cache OLDER than 24h — keeps the ACTIVE go-build/golangci/node cache warm so the
# next build stays fast. Do NOT `-a` here: `builder prune -a` frees max disk but forces a full cold
# rebuild (a ~15min go-mod-download + recompile tax). Use `make docker-gc-hard` only when truly full.
docker-gc:
	@echo "[docker-gc] pruning build cache older than 24h + dangling images"
	@docker builder prune -f --filter until=24h
	@docker image prune -f

# docker-gc-hard —— nuke ALL build cache (next build is a cold rebuild, slow). Last resort when the
# VM disk is near its cap and docker-gc didn't free enough.
docker-gc-hard:
	@docker builder prune -af
	@docker image prune -f

# ── release: push images to the registry ─────────────────────────────────
#
# A repo has two paths that send bytes out into the world, and each one sees a different set of
# things:
#
#   `git push`  → the entire **history**. A secret deleted in a later commit is still there in
#                 that earlier one, pushed and all.
#   registry    → the **image filesystem**. `.gitignore` has no say over it — `.dockerignore`
#                 does, and those two lists are not the same one. This machine right now has
#                 real credentials sitting on it (a Google OAuth client-secret and a few PEMs
#                 under `.playwright-mcp/`, `eval-harness/.env`): they can't reach git, but
#                 whether they reach an image is a separate question, answered by that other list.
#
# So before pushing, scan both: `secrets` scans history + the staging area, `secrets-image`
# scans the **image itself**.
#
# **Why scan the image rather than its build context**: the context is a stand-in. The check
# needs to land on the actual thing that's about to go out — a missed `.dockerignore` line, an
# extra `COPY` in the Dockerfile, and a context scan sees neither, while an image scan does.
REGISTRY ?= ghcr.io/atmaxmoj

# TAG —— **derived from the git tag, never hand-filled**. On the commit tagged `v0.0.1` it is
# `v0.0.1`; the next commit is `v0.0.1-3-gabc1234`, and you can tell at a glance "this is not
# that release." A version number has exactly one home ([[a fact belongs to the party that
# produces it]]) — copying it a second time into the Makefile turns "remember to update the
# version" into a rule someone eventually forgets.
TAG ?= $(shell git describe --tags --always --dirty)

# db is in there too: Coolify's "paste a compose file" has no repo behind it, so a relative
# mount like `./backend/db/schema.sql` inevitably points at nothing — and postgres's behavior
# when its mount is empty is to **silently start an empty database**. Baking the schema into the
# image means a registry deploy needs zero mounts (infra/db/Dockerfile).
IMAGES := backend app builder im-bridge db

# release-build —— builds the four images by REGISTRY/TAG (without pushing).
# app's .next is built on the host and COPYd into the image, so that step has to run first.
#
# context / dockerfile / target come from the same source as docker-compose.prod.yml. Uses
# `docker build` rather than `compose build`: `compose images -q` looks at the **running
# containers**, and with none running it returns an empty string — so the tagging step would
# get an empty source (that's exactly how it blew up the first time). Releasing doesn't need any
# container running.
#
# ── app-build isn't reused here, because the release app is **a different build** ──────────────────────────
#
# `next.config.ts` already declares a dual-build: with `STRIP_TEST_HOOKS=1`, SWC strips every
# `data-testid` at compile time; the comment there says it's "for the build actually shipped to
# visitors."
# And that variable **appears nowhere else in the whole repo** — nothing ever set it (F-A-45).
# So to this day, every single app image has shipped all 804 testids to visitors unchanged: they
# are documentation of internal component structure, and stable selectors for
# scraping/automation — while the whole point of the captcha and rate-limiting machinery is to
# make automation expensive.
#
# **Only strips on this path**: dev's e2e locates elements by testid, and the real-env audit on
# the prod stack also drives by testid. Neither of those is "the build shipped to visitors."
# RELEASE_PLATFORMS —— the release image must be **multi-architecture**.
#
# Learned the hard way: v0.0.3 was built on a Mac, all five images came out linux/arm64. Pushed
# to ghcr, deployed to an x86_64 server — **it pulled fine, it just wouldn't run**, every
# container exited immediately on start. The symptom was deeply misleading: db / redis / minio,
# which have nothing to do with our config, also exited — so it looked like the whole compose
# file was broken, and chasing that cost a full round each on variable expansion, image
# visibility, compose parsing, and volume naming as four separate theories. The actual
# difference was just "this machine is arm64."
#
# We don't control what machine a self-hoster runs, so the release surface has to cover both.
RELEASE_PLATFORMS ?= linux/amd64,linux/arm64

release-build: sdk-build builder-vendor
	@pnpm install --frozen-lockfile
	@STRIP_TEST_HOOKS=1 pnpm -F standmeet-app build
	@$(MAKE) release-assert-stripped
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  echo "[release] building $$img"; \
	  case $$svc in \
	    backend)   docker build -t $$img -f backend/Dockerfile --target production \
	                 --build-arg STANDMEET_VERSION=$(TAG) . ;; \
	    app)       docker build -t $$img ./app ;; \
	    builder)   docker build -t $$img ./builder ;; \
	    im-bridge) docker build -t $$img -f im-bridge/Dockerfile . ;; \
	    db)        docker build -t $$img -f infra/db/Dockerfile . ;; \
	  esac || exit 1; \
	  docker tag $$img $(REGISTRY)/standmeet-$$svc:latest || exit 1; \
	done
	@$(MAKE) release-assert-version
	@echo "[release] built: $(IMAGES) @ $(TAG)"

# release-assert-version —— **asks the image itself which version it is**, not the build command.
#
# The version number gets burned into the binary via `-ldflags -X` at release time, and a
# missed build-arg is **silent**: the image still builds fine, still runs fine, it just reports
# the zero-value from then on to anyone who asks. This defect just bit us once — that `var` was
# reserved specifically for ldflags, its comment even says "overwritten at release time", and
# the build command simply never had that line — so what shipped was an image running v0.1.3
# while `/api/v1/instance` reported 0.1.0. The one use a version number has is being able to say
# clearly, when something goes wrong, exactly which build you're on — and a number disconnected
# from the actual build cancels that use out entirely.
#
# Judges the **artifact**: start the container, `--version`, compare what it says against
# $(TAG) character for character. Needs no db/redis/the stack at all — that subcommand returns
# before config.Load even runs.
release-assert-version:
	@img=$(REGISTRY)/standmeet-backend:$(TAG); \
	  got=$$(docker run --rm --entrypoint /app/standmeet $$img --version 2>&1 | tail -1); \
	  test "$$got" = "$(TAG)" || { \
	    echo "release: $$img self-reports version '$$got', but this release is '$(TAG)'"; \
	    echo "         this is what happens when --build-arg STANDMEET_VERSION is missed — the image runs, the version is fake"; \
	    exit 2; }; \
	  echo "  backend self-reports $$got ✓"

# release-assert-stripped —— **proves** the strip happened, rather than trusting that it did.
#
# This switch lives inside a string comparison in next.config.ts: rename it, upgrade Next,
# touch that part of the compiler config, and it silently stops working — and a broken strip
# looks exactly the same as a working one (the image still builds, still runs fine). So this
# step judges both "did the strip actually happen" and "did I actually scan anything real":
# with an empty artifact directory, "zero testids" would be a meaningless truth.
# Three exemptions, each **mechanical** (by path), never a hand-maintained testid list:
#   · node_modules —— Next's own devtools package ships `data-testid="geist-icon"`. Someone
#     else's code.
#   · server.js / required-server-files.json —— those are **config echoed back**
#     (`"reactRemoveProperties":{"properties":["^data-testid$"]}`), not an attribute on an
#     element. Its presence there is exactly the proof the strip is wired up.
#   · /admin/ —— this rule strips **JSX attributes**; an **object key** handed to a third-party
#     library (Tiptap's `editorProps.attributes`) is structurally invisible to it. That spot
#     lives in the owner's editor, and this switch's stated purpose is "clean HTML shipped to
#     visitors" — visitors never reach /admin.
release-assert-stripped:
	@test -d app/.next/standalone || { echo "release: app/.next/standalone does not exist — nothing was scanned, 'zero testids' doesn't count"; exit 2; }
	@files=$$(find app/.next/standalone -type f -not -path '*/node_modules/*' | wc -l | tr -d ' '); \
	  test "$$files" -gt 100 || { echo "release: scan surface was only $$files files — that's wrong"; exit 2; }; \
	  hits=$$(grep -rl "data-testid" app/.next/standalone 2>/dev/null \
	    | grep -v '/node_modules/' \
	    | grep -v '/server\.js$$' \
	    | grep -v '/required-server-files\.json$$' \
	    | grep -v '/app/admin/'); \
	  test -z "$$hits" || { \
	    echo "release: data-testid still present in the visitor-facing build — either STRIP_TEST_HOOKS didn't fire,"; \
	    echo "         or someone passed a testid as an object key to a library (that can't be stripped — move it to a JSX attribute):"; \
	    echo "$$hits" | sed 's/^/           /'; exit 1; }; \
	  echo "[release] visitor-side build has testids stripped (scanned $$files files)"

# secrets-image —— scans **the filesystem of the exact image about to be shipped**.
#
# `docker export` output is that image's rootfs, not an approximation of it.
#
# **What this actually guards against**: the git gate can only see tracked files. What's inside
# an image is decided by `.dockerignore` — a file git ignores can still make it into the image.
# This machine right now has real credentials sitting in exactly that spot (a Google OAuth
# client-secret and PEMs under `.playwright-mcp/`, `eval-harness/.env`): they can't reach
# history, so this gate is the only thing that might catch them.
#
# **What it doesn't cover** (said explicitly, so "all images clean" doesn't read as full
# coverage):
#   · gitleaks skips binaries. The backend image is 77 MB; what gets scanned is 3.7 MB — the Go
#     executable itself is never scanned. Acceptable because any string inside it can only have
#     come from **source** (scanned by the history gate) or a build arg (we pass none) —
#     not because it was actually scanned.
#   · What's excluded below is **directories the base image ships on its own** (node's headers,
#     system libraries, third-party dependency trees). Those bytes aren't ones we put there,
#     they arrived as-is from upstream. Everything we COPY ourselves (/app, /srv, binaries)
#     stays inside the scan surface. Two of the exclusions were added when the db image joined,
#     each verified for provenance:
#       `etc/ssl/private/` —— a self-signed placeholder cert (snakeoil) Debian's `ssl-cert`
#         package generates in postinst. Already present in the upstream `pgvector/pgvector:pg16`
#         image; this stack talks to the db with `sslmode=disable`, so it's dead weight.
#       `usr/lib/` —— distro libraries and headers (the one that triggered this was perl's
#         CORE/cop.h).
#     Both verified: none of the five Dockerfiles write anything into those two paths, so
#     excluding them can't hide any of our own bytes.
secrets-image:
	@command -v gitleaks >/dev/null 2>&1 || { \
	  echo "secrets-image: gitleaks is not installed — this gate cannot run."; \
	  echo "               install it rather than skipping: a skipped secret scan"; \
	  echo "               reports success for work it did not do."; exit 2; }
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  docker image inspect $$img >/dev/null 2>&1 || { \
	    echo "secrets-image: $$img not built — run 'make release-build' first"; exit 2; }; \
	  echo "[secrets-image] $$img"; \
	  d=$$(mktemp -d); \
	  cid=$$(docker create $$img); \
	  docker export $$cid | tar -x -C $$d \
	    --exclude='*node_modules*' --exclude='*site-packages*' \
	    --exclude='usr/local/go/*' --exclude='root/go/pkg/*' \
	    --exclude='usr/include/*' --exclude='usr/local/include/*' \
	    --exclude='usr/share/*' --exclude='usr/lib/*' \
	    --exclude='etc/ssl/private/*' 2>/dev/null || true; \
	  docker rm -f $$cid >/dev/null; \
	  wd=$$(docker image inspect $$img --format '{{.Config.WorkingDir}}'); \
	  can=$$d$${wd:-}/.sm-secrets-canary.txt; \
	  : "The canary must hit a rule that **ignores entropy**. The original planted value was"; \
	  : "aws_secret_access_key, and that rule carries an entropy threshold — a random string"; \
	  : "always has some fraction fall below the threshold, so the self-test would fail"; \
	  : "intermittently (that's exactly what happened once for the builder image in v0.1.1),"; \
	  : "and **a failing self-test blocks the whole release**. A private-key block is a"; \
	  : "structural rule, not entropy-based. check-secrets.sh switched for the same reason a"; \
	  : "while ago — this spot just never got the same fix."; \
	  : "The filename on this line is unquoted with backticks deliberately: comments inside a"; \
	  : "recipe are still shell, and a backtick is command substitution — quoting it would mean"; \
	  : "every release hunts PATH for a same-named script and executes it."; \
	  mkdir -p $$(dirname $$can); \
	  printf -- '-----%s RSA PRIVATE KEY-----\n%s\n-----%s RSA PRIVATE KEY-----\n' \
	    BEGIN "$$(LC_ALL=C tr -dc 'A-Za-z0-9+/' < /dev/urandom | head -c 64)" END > $$can; \
	  : "The coverage numbers get printed. The previous version just said clean — and what we"; \
	  : "ourselves COPY into the backend image is 6 Go binaries + 1 entrypoint.sh; gitleaks"; \
	  : "skips binaries, so what this gate actually scans on that image is **one shell"; \
	  : "script**. It prints the same word 'clean' as the app image (where the entire .next is"; \
	  : "text), while the evidence behind the two differs by three orders of magnitude. Without"; \
	  : "a count, 'clean' reads like full coverage."; \
	  txt=$$(find $$d -type f -exec file -b --mime-type {} \; 2>/dev/null | grep -c '^text/' || true); \
	  bin=$$(find $$d -type f -exec file -b --mime-type {} \; 2>/dev/null | grep -c 'executable' || true); \
	  echo "                 scan surface: $$txt text files / $$bin binaries skipped"; \
	  rep=$$(mktemp -t sm-secrets-XXXX).json; \
	  gitleaks dir $$d --config .gitleaks.toml --no-banner --redact \
	    --report-format json --report-path $$rep >/dev/null 2>&1; \
	  python3 infra/scripts/secrets-image-verdict.py $$rep $$d "$$img" \
	    "$${wd:-}/.sm-secrets-canary.txt"; st=$$?; \
	  rm -rf $$d $$rep; \
	  [ $$st -eq 0 ] || exit $$st; \
	done
	@echo "[secrets-image] all $(words $(IMAGES)) images clean"

# release-repro —— brings up a compose file locally using **the already-released images**, for
# the sole purpose of reading their logs.
#
# Why it exists: the remote Coolify instance runs 4.1.2, and the container/service log API
# endpoint was **only added in 4.2.0** (found this in the changelog, not from a wrong path). And
# that machine has no SSH access. So "why did the container exit" was unreachable on that
# machine.
#
# But that's "can't get logs **off that machine**", not "can't get logs at all": the image is
# public, compose can read it, and running the same thing locally puts every log in hand. Using
# this to debug something that won't start in production is far cheaper than testing hypotheses
# one at a time.
#
#   make release-repro FILE=<compose path>        bring it up
#   make release-repro-logs FILE=<same file>       read the logs
#   make release-repro-down FILE=<same file>       tear it down
REPRO_PROJECT ?= smrepro
release-repro:
	@test -n "$(FILE)" || (echo "usage: make release-repro FILE=<compose.yml>"; exit 2)
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) up -d --remove-orphans || true
	@echo "[repro] up. read the logs: make release-repro-logs FILE=$(FILE)"

release-repro-logs:
	@test -n "$(FILE)" || (echo "usage: make release-repro-logs FILE=<compose.yml>"; exit 2)
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) ps
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) logs --tail=$(LINES) 2>&1 | tail -n 200

release-repro-down:
	@test -n "$(FILE)" || (echo "usage: make release-repro-down FILE=<compose.yml>"; exit 2)
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) down -v --remove-orphans

# release-push —— **multi-architecture** build and push. Both secret gates are its
# prerequisites, no way around them.
#
# Why this rebuilds instead of `docker push`-ing the local copy: a multi-arch image **can't be
# loaded into the local daemon** (a tag can only hold one platform), so it has to go straight
# out via buildx. The `release-build` copy still has a purpose — it's what `secrets-image`
# scans, and it's the copy used for local reproduction.
#
# The only byte-level difference between the two is in the base image's own binaries: everything
# we COPY ourselves is byte-for-byte identical, so scanning the local copy is a valid answer to
# "did a secret get baked in."
#
# Login isn't handled here: `docker login ghcr.io` needs a PAT, and that's something the owner
# types in themselves.
release-push: secrets secrets-image
	@docker buildx inspect standmeet-release >/dev/null 2>&1 \
	  || docker buildx create --name standmeet-release --driver docker-container >/dev/null
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  echo "[release] buildx --push $$img ($(RELEASE_PLATFORMS))"; \
	  case $$svc in \
	    backend)   ctx="-f backend/Dockerfile --target production --build-arg STANDMEET_VERSION=$(TAG) ." ;; \
	    app)       ctx="./app" ;; \
	    builder)   ctx="./builder" ;; \
	    im-bridge) ctx="-f im-bridge/Dockerfile ." ;; \
	    db)        ctx="-f infra/db/Dockerfile ." ;; \
	  esac; \
	  docker buildx build --builder standmeet-release \
	    --platform $(RELEASE_PLATFORMS) \
	    -t $$img -t $(REGISTRY)/standmeet-$$svc:latest \
	    --push $$ctx \
	    || { echo "[release] push failed — logged in? docker login ghcr.io"; exit 1; }; \
	done
	@$(MAKE) release-assert-multiarch
	@echo "[release] pushed $(IMAGES) @ $(TAG) + latest to $(REGISTRY)"

# release-assert-multiarch —— **the pushed manifest must actually contain amd64**.
#
# Not overkill: v0.0.3 was pushed entirely arm64, pulled fine, and wouldn't run on x86_64 — and
# the symptom, "every container exits on start", looked like compose was broken. One missed
# `--platform`, one buildx builder falling back to the default driver, and the release surface
# silently shrinks to a single architecture.
# So this judges the result, not the command.
# `2>/dev/null` was removed — it was swallowing whatever reason `docker manifest inspect`
# actually failed for, so whenever the registry hadn't synced yet after a push, or auth had
# expired, this gate died on a bare `JSONDecodeError: Expecting value: line 1 column 1` with the
# real reason nowhere in sight.
# It has already false-alarmed twice this way (v0.0.6 / v0.0.7) — both times all five images had
# actually been pushed, both architectures and all.
# Empty output now says it's empty; the reader's first line is whatever docker itself said.
release-assert-multiarch:
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  raw=$$(docker manifest inspect $$img) || \
	    { echo "release: docker manifest inspect $$img failed (the line above is its stated reason)"; exit 1; }; \
	  archs=$$(printf '%s' "$$raw" \
	    | python3 -c "import sys,json;d=json.load(sys.stdin);print(' '.join(sorted({m['platform']['architecture'] for m in d.get('manifests',[]) if m['platform']['architecture']!='unknown'})))"); \
	  case "$$archs" in \
	    *amd64*) echo "  $$svc: $$archs" ;; \
	    *) echo "release: $$img has no amd64 (only '$$archs') — an x86_64 machine can pull it but can't run it"; exit 1 ;; \
	  esac; \
	done
	@echo "[release] all five images have amd64 ✓"

# This used to have a single-arch `docker push` version. Deleted rather than kept: it pushed
# exactly the kind of arm64-only image that broke v0.0.3, and leaving an entry point that can
# reintroduce that defect means someone eventually takes it. Release only has one path: buildx.
