# Makefile is the single entry point for repo tasks.  Run `make lint`
# before committing; that runs every check the CI would run, in the
# order failures surface fastest.
#
# Same shape as the API service's Makefile, minus the bits that don't
# apply to a leaf service: no wire-generated file to keep in sync
# (no `wire-check` / `wire` targets). schema lives in db/schema.sql
# applied at db volume init—no goose migration runner.

.PHONY: lint build test arch fmt-check max-lines routes-cyclo boundary-thin no-nil-container build-check secrets golangci-config escape-lint connector-boundary core-agnostic internal-dirs domain-acyclic infra-not-domain routes-not-imported domain-facade-boundary domain-layering hostops-via-desk periodic-via-scheduler

# sqlc generation lives in the root Makefile (`make sqlc-gen`) so it works
# the same way for app/sdk/backend devs. Don't duplicate it here.

# `make lint` is the gate everything else runs.  Each step is
# independent + fast; the order is "fastest to fail" so a syntax
# typo dies before the slow arch scan.  Everything that gates a
# commit lives here — there are no "also run X" steps anywhere else,
# so the lefthook pre-commit and CI both just call `make lint`.
lint: fmt-check golangci-config max-lines routes-cyclo routes-via-dispatcher hostops-via-desk periodic-via-scheduler boundary-thin no-nil-container no-raw-http arch connector-boundary core-agnostic internal-dirs domain-acyclic infra-not-domain routes-not-imported domain-facade-boundary domain-layering build-check golangci escape-lint secrets

# gofmt diff is instant — anything malformed fails here first.
fmt-check:
	@diff=$$(gofmt -l .); \
	if [ -n "$$diff" ]; then \
	  echo "gofmt: the following files are not formatted:"; \
	  echo "$$diff"; \
	  exit 1; \
	fi

# Cap every Go source file under cmd/ + internal/ at 350 lines.
max-lines:
	@bash ../infra/scripts/check-max-lines.sh

# Faces and domain facades stay at cyclo ≤ 3 — anything richer is business
# logic, which belongs in the domain where every caller gets it.
routes-cyclo:
	@bash ../infra/scripts/check-routes-cyclo.sh
	@bash ../infra/scripts/check-routes-cyclo-test.sh

# Container types (slice/map/chan) must never return nil — project principle.
# Optional uses *T; collections always return empty container.
no-nil-container:
	@tool=$$(mktemp) && ( cd ../infra/scripts/check-no-nil-container && go build -o "$$tool" . ) && "$$tool"; rc=$$?; rm -f "$$tool"; exit $$rc

# Faces may reach capability only through the outbound convergence point
# (internal/routes/dispatcher) — a handler that imports a domain facade directly
# has bypassed it, so nothing can guarantee parity or apply policy for that op.
# Shrink-only baseline of the files that predate the dispatcher.
routes-via-dispatcher:
	@tool=$$(mktemp) && ( cd ../infra/scripts/check-routes-via-dispatcher && go build -o "$$tool" . ) && "$$tool"; rc=$$?; rm -f "$$tool"; \
		[ $$rc -eq 0 ] && bash ../infra/scripts/check-routes-via-dispatcher-test.sh; rc2=$$?; exit $$((rc + rc2))

# The inbound mirror: a sandboxed capability reaches back only through the inbound
# convergence point (internal/routes/hostdesk). Only the desk opens a capability
# socket, and only a domain (or an axis's own mechanism) declares a host op — the
# assembly root wires deps, it never mints verbs.
hostops-via-desk:
	@bash ../infra/scripts/check-hostops-via-desk.sh
	@bash ../infra/scripts/check-hostops-via-desk-test.sh

# Anything on a timer runs through the one scheduler (internal/infra/periodic).
# A hand-written loop carries its own bookkeeping, and the bookkeeping is what
# drifts: the schedule shown on the panel was written next to the interval instead
# of derived from it, and the Register call was optional — so a loop could run
# forever and never appear on the panel at all.
periodic-via-scheduler:
	@bash ../infra/scripts/check-periodic-via-scheduler.sh
	@bash ../infra/scripts/check-periodic-via-scheduler-test.sh

# Boundaries only declare and hand over: a facade re-exports its domain, and the
# dispatcher aggregates facades. Payload shapes, op schemas and reaching past a
# facade are the three signals that a boundary grew a version of its own.
boundary-thin:
	@tool=$$(mktemp) && ( cd ../infra/scripts/check-boundary-thin && go build -o "$$tool" . ) && "$$tool"; rc=$$?; rm -f "$$tool"; \
		[ $$rc -eq 0 ] && bash ../infra/scripts/check-boundary-thin-test.sh; rc2=$$?; exit $$((rc + rc2))

# All outbound HTTP must go through internal/httpx (retry + timeout + egress);
# raw &http.Client{} / http.Get/Post anywhere else opts out of that infra.
no-raw-http:
	@bash ../infra/scripts/check-no-raw-http.sh

# go-arch-lint enforces the DDD layer arrows (.go-arch-lint.yml).
arch:
	@"$$(go env GOPATH)/bin/go-arch-lint" check

# Phase B structural gate: outbound connector clients (gcal/mailer) may only
# be reached through the connector layer — credentials never leave the vault
# into capability/usecases code. Red until the connector proxy lands.
connector-boundary:
	@bash ../infra/scripts/check-connector-boundary.sh

# #135 structural lock (Layer 4): the kernel (internal/usecases + inference +
# domain) must name ZERO concrete capabilities/connectors. go-arch-lint only
# governs import arrows; this string ratchet catches capability logic sitting
# inside a kernel package. Baseline .core-agnostic-baseline only ever shrinks.
core-agnostic:
	@bash ../infra/scripts/check-core-agnostic.sh

# #135 类图对齐:internal/ 只允许类图 8 core 模块 + routes + usecases + domain-less infra。
# 类图里没有的目录(plugins 等)是"多出来的",baseline 只能缩 —— 逼着一个个拆掉归位。
internal-dirs:
	@bash ../infra/scripts/check-internal-dirs.sh

# domain-acyclic: the domain graph (8 core + capabilities) must be acyclic. go-arch-lint only
# checks package level; subpackages can split a domain cycle into a package DAG and slip past it.
domain-acyclic:
	@bash ../infra/scripts/check-domain-acyclic.sh

# infra-not-domain: internal/infra/** must not import a domain (leaf base knows no domain). Baseline only shrinks.
infra-not-domain:
	@bash ../infra/scripts/check-infra-not-domain.sh

# routes-not-imported: internal/routes/** is top layer; only entrypoints (cmd/agentcore) may mount it. Baseline only shrinks.
routes-not-imported:
	@bash ../infra/scripts/check-routes-not-imported.sh

# domain-facade-boundary: a domain with a facade/ dir is reachable from outside only via .../facade.
domain-facade-boundary:
	@bash ../infra/scripts/check-domain-facade-boundary.sh

# domain-layering: inside a faceted domain the DDD layers only import downward
# (entity/db/infra < repo < service < usecase < facade); guts never back-reference the facade.
domain-layering:
	@bash ../infra/scripts/check-domain-layering.sh

# Catch compile errors at lint time.
build-check:
	@go build ./... >/dev/null

# golangci-config verifies .golangci.yml against the v2 schema.
golangci-config:
	@if command -v golangci-lint >/dev/null 2>&1; then \
	  golangci-lint config verify; \
	else \
	  "$$(go env GOPATH)/bin/golangci-lint" config verify; \
	fi

# golangci-lint runs the full linter set.  Slowest of the three,
# runs last.  --timeout=30m so docker-builder boxes don't trip the
# default 1m ceiling when the eino dep tree expands the scan surface.
golangci:
	@if command -v golangci-lint >/dev/null 2>&1; then \
	  golangci-lint run --timeout=30m ./...; \
	else \
	  "$$(go env GOPATH)/bin/golangci-lint" run --timeout=30m ./...; \
	fi

# escape-lint verifies compiler escape-analysis decisions against
# `//no-escape` / `//must-inline` / `//no-bounds-check` annotations.
# No-op until the first hot path is marked.
escape-lint:
	@go build -gcflags="-m -d=ssa/check_bce" ./... 2>/tmp/auth-escape.log || true
	@"$$(go env GOPATH)/bin/go-escape-lint" -f /tmp/auth-escape.log -pkg .
	@rm -f /tmp/auth-escape.log

# Scan for secrets — pre-commit-only gate.
secrets:
	@if ! command -v gitleaks >/dev/null 2>&1; then \
	  echo "secrets: gitleaks not installed, skipping (pre-commit on host catches this)"; \
	  exit 0; \
	fi; \
	if [ -d .git ]; then \
	  gitleaks protect --staged --no-banner --redact >/dev/null 2>&1 \
	    || { echo "gitleaks: secrets in staged diff — abort commit."; exit 1; }; \
	else \
	  echo "secrets: no .git in cwd, skipping (pre-commit on host catches this)"; \
	fi

# `make test` runs the Go unit/integration tests (testify, no DB/docker).
# Pure-logic + in-process coverage; e2e lives in the root `make test`.
# -race is on by design: shared runtime state (e.g. the connector Hub, resolved
# per request across goroutines) can only be guarded here — a data race is a real
# bug the green-but-sequential e2e suite structurally cannot see.
test:
	go test -race ./...

# `make build` produces a local binary at ./bin/standmeet for ad-hoc
# inspection.  Production binaries come out of the Dockerfile.
build: lint
	@mkdir -p bin
	go build -trimpath -o bin/standmeet ./cmd/server
