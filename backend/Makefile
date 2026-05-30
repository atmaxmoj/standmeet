# Makefile is the single entry point for repo tasks.  Run `make lint`
# before committing; that runs every check the CI would run, in the
# order failures surface fastest.
#
# Same shape as the API service's Makefile, minus the bits that don't
# apply to a leaf service: no wire-generated file to keep in sync
# (no `wire-check` / `wire` targets). schema lives in db/schema.sql
# applied at db volume init—no goose migration runner.

.PHONY: lint build arch fmt-check max-lines routes-cyclo no-nil-container build-check secrets golangci-config escape-lint

# sqlc generation lives in the root Makefile (`make sqlc-gen`) so it works
# the same way for app/sdk/backend devs. Don't duplicate it here.

# `make lint` is the gate everything else runs.  Each step is
# independent + fast; the order is "fastest to fail" so a syntax
# typo dies before the slow arch scan.  Everything that gates a
# commit lives here — there are no "also run X" steps anywhere else,
# so the lefthook pre-commit and CI both just call `make lint`.
lint: fmt-check golangci-config max-lines routes-cyclo no-nil-container arch build-check golangci escape-lint secrets

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
	@bash scripts/check-max-lines.sh

# Route handlers must stay at cyclo ≤ 3 — anything richer is business
# logic leaking into the presentation layer.
routes-cyclo:
	@bash scripts/check-routes-cyclo.sh

# Container types (slice/map/chan) must never return nil — project principle.
# Optional uses *T; collections always return empty container.
no-nil-container:
	@go run ./cmd/check-no-nil-container

# go-arch-lint enforces the DDD layer arrows (.go-arch-lint.yml).
arch:
	@"$$(go env GOPATH)/bin/go-arch-lint" check

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
# runs last.
golangci:
	@if command -v golangci-lint >/dev/null 2>&1; then \
	  golangci-lint run ./...; \
	else \
	  "$$(go env GOPATH)/bin/golangci-lint" run ./...; \
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

# `make build` produces a local binary at ./bin/standmeet for ad-hoc
# inspection.  Production binaries come out of the Dockerfile.
build: lint
	@mkdir -p bin
	go build -trimpath -o bin/standmeet ./cmd/server
