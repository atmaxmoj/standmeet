# syntax=docker/dockerfile:1
# The backend imports NO plugin code: mcp-servers/* are pure runtime artifacts
# (static binaries built from their own Go modules). The host↔plugin contract is
# the manifest + the runtime MCP protocol, never a Go dependency. In dev they are
# bind-mounted from infra/plugins (built by provision.sh); here in prod they are
# BAKED into /srv/plugins in the builder stage (Stage 2) — they are product
# artifacts and must ship with the image, else the bwrap sandbox can't spawn
# retrieval and visitor grounding is dead (F-A-1). The build context is repo-root
# (docker-compose: context: .) so mcp-servers/ is reachable.

# Stage 1: Deps
#
# ── This used to run a full `make lint` ────────────────────────────────────────────
#
# Removed, because what it checks **has already been checked once**: lefthook's
# pre-commit runs the very same `make lint` chain, the same source, the same rules.
# Code that can't get committed can't get into the image, so this pass catches
# nothing the earlier pass didn't.
#
# The cost was real: one release builds five images, and this backend slot would run
# 20-odd checkers plus golangci again; and when `release-push` goes through buildx
# dual-arch, it runs it **once more** on amd64 (emulated execution, even slower).
# The same lint runs three times on one release chain, and each spot looks reasonable
# on its own — the duplication is what they compose into.
#
# The risk this trades for, stated plainly: **the image no longer proves its own code
# is clean**; it trusts the commit gate. The only way around that gate is
# `git commit --no-verify`. If we truly want an independent gate, it belongs in CI
# (which this repo doesn't have yet), not a re-run on every build.
# `--platform=$BUILDPLATFORM` — the toolchain runs on **the build machine's** arch,
# not the target arch.
#
# Why write this: releases are multi-arch (linux/amd64 + linux/arm64). Without it,
# buildx pulls an amd64 golang image for the amd64 path and **runs the whole Go tree's
# compile under QEMU emulation** on an arm64 Mac — measured at over 35 minutes for
# this one slot alone, hours for five images.
#
# But Go cross-compiles natively: let the compiler run native and just set `GOARCH`
# to the target arch (see the builder stage). Emulation emulates **execution**;
# cross-compilation swaps the **output** — the latter has none of that cost.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS deps
WORKDIR /app

RUN apk add --no-cache git bash make

# Fetch deps first (a separate cache layer). The backend no longer imports any
# mcp-servers module, so only backend's own deps are needed.
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /app/backend
RUN go mod download

WORKDIR /app
COPY backend ./backend
COPY infra/scripts ./infra/scripts
WORKDIR /app/backend

# Stage 2: Build
FROM deps AS builder
# TARGETARCH is injected by buildx per the path currently being built (amd64 / arm64).
# CGO is off, so this is pure cross-compilation — no target-arch toolchain needed.
ARG TARGETARCH
# STANDMEET_VERSION — burns the release tag into the binary. `port.appVersion` was a
# `var` precisely for this line, and this line was never written: so the instance
# reported the literal from source, unrelated to the image actually running.
# v0.1.3 running in prod while /api/v1/instance said 0.1.0 came from exactly this.
# If unset it stays that literal — which is why it now reads "dev", so it's obvious
# at a glance that "this build was never stamped".
ARG STANDMEET_VERSION=dev
ENV CGO_ENABLED=0 GOOS=linux
RUN --mount=type=cache,target=/root/.cache/go-build \
    GOARCH=$TARGETARCH go build \
    -trimpath \
    -ldflags="-s -w -X github.com/atmaxmoj/standmeet/cmd/server/port.appVersion=${STANDMEET_VERSION}" \
    -o /out/standmeet \
    ./cmd/server

# Builtin capability plugins (mcp-servers/*) → static binaries at /srv/plugins.
# These are PRODUCT artifacts (retrieval / booker / summarize / ask_visitor /
# mail-sender), each its own Go module, loaded at runtime by the bwrap
# sandbox_stdio path (ro-bind /srv/plugins/<name>, exec /plugin/<name>). Dev
# bind-mounts infra/plugins; prod bakes them — without them the retrieval
# sandbox can't spawn and every visitor turn binds zero tools (F-A-1).
WORKDIR /app
COPY mcp-servers ./mcp-servers
RUN --mount=type=cache,target=/root/.cache/go-build \
    for p in ask-visitor summarize booker retrieval mail-sender; do \
      (cd /app/mcp-servers/"$p" && \
        GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' \
          -o /srv/plugins/"$p"/"$p" .) || exit 1; \
    done
WORKDIR /app/backend

# Stage 3: Production
FROM alpine:3.21 AS production
# ghcr → repo linkage: GitHub reads this to list the pushed image under the repo's Packages.
LABEL org.opencontainers.image.source="https://github.com/atmaxmoj/standmeet"
WORKDIR /app

# ca-certificates + docker-cli (legacy skill sandbox).
# bubblewrap + node + python3: the MCP-plugin sandbox. The main process launches
# third-party MCP servers via `bwrap` (an isolation env, no image) — the server
# code rides a mounted dir, but the interpreters live here in the host image and
# bwrap bind-mounts them read-only into the sandbox.
RUN apk add --no-cache ca-certificates docker-cli bubblewrap nodejs npm python3

# Typst — the resume PDF rendering engine (internal/owner/jobs/resumepdf spawns a typst
# subprocess). Download the musl static release, selected by target arch
# (amd64→x86_64 / arm64→aarch64). typst ships default fonts (serif + monospace), so it
# renders even without Newsreader/JetBrains Mono installed (glyphs fall back to the
# defaults; layout/colors unchanged).
ARG TARGETARCH
RUN set -eux; \
    apk add --no-cache --virtual .typst-dl wget xz tar; \
    case "$TARGETARCH" in amd64) TA=x86_64;; arm64) TA=aarch64;; *) echo "unsupported arch $TARGETARCH"; exit 1;; esac; \
    ver=v0.13.1; \
    wget -qO /tmp/typst.tar.xz "https://github.com/typst/typst/releases/download/${ver}/typst-${TA}-unknown-linux-musl.tar.xz"; \
    tar -xJf /tmp/typst.tar.xz -C /tmp; \
    mv "/tmp/typst-${TA}-unknown-linux-musl/typst" /usr/local/bin/typst; \
    rm -rf /tmp/typst*; \
    apk del .typst-dl; \
    typst --version

RUN addgroup --system --gid 1001 standmeet && \
    adduser --system --uid 1001 --ingroup standmeet standmeet

COPY --from=builder --chown=standmeet:standmeet /out/standmeet /app/standmeet
COPY --from=builder --chown=standmeet:standmeet /app/backend/entrypoint.sh /app/entrypoint.sh
RUN mkdir -p /srv && chown standmeet:standmeet /srv
# Bake the builtin capability plugins so the bwrap sandbox finds them at /srv/plugins/<name>.
COPY --from=builder --chown=standmeet:standmeet /srv/plugins /srv/plugins

USER standmeet

EXPOSE 8000
ENV PORT=8000
ENV HOST=0.0.0.0

ENTRYPOINT ["/app/entrypoint.sh"]
