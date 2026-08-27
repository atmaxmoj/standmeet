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
# ── 这里曾经跑一整套 `make lint` ────────────────────────────────────────────────────
#
# 撤掉了，因为它检查的东西**已经被检查过一次**：lefthook 的 pre-commit 跑的就是同一条
# `make lint` 链、同一份源码、同一套规则。代码进不了提交就进不了镜像，所以这一遍
# 拦不住任何前一遍拦不住的东西。
#
# 代价是实打实的：一次发布五个镜像，backend 这一格要把 20 多个检查器加 golangci 再跑一遍；
# 而 `release-push` 走 buildx 双架构时，它在 amd64 上还要**再跑一遍**（模拟执行，更慢）。
# 同一套 lint 在一条发布链上跑三次，而每一处单独看都说得通 —— 重复是它们组合出来的。
#
# 换来的风险，说清楚：**镜像不再自己证明代码干净**，它信任提交那一关。
# 绕过的办法只有 `git commit --no-verify`。真要一道独立的门，它该在 CI 上（这个仓库
# 现在没有），而不是让每次构建重跑一遍。
# `--platform=$BUILDPLATFORM` —— 工具链跑在**构建这台机器**的架构上，不跟着目标架构走。
#
# 为什么要写这一句：发布是多架构的（linux/amd64 + linux/arm64）。不写的话，
# buildx 会为 amd64 那一路拉一个 amd64 的 golang 镜像，在 arm64 的 Mac 上**用 QEMU 模拟执行**
# 整棵 Go 树的编译 —— 实测单这一格跑了 35 分钟还没完，五个镜像要几小时。
#
# 而 Go 本来就是交叉编译的：让编译器原生跑，把 `GOARCH` 换成目标架构就行（见 builder stage）。
# 模拟的是**执行**，交叉编译换的是**输出**，后者没有那个代价。
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS deps
WORKDIR /app

RUN apk add --no-cache git bash make

# 依赖先下（独立缓存层）。backend 不再 import 任何 mcp-servers 模块，只需 backend 自己。
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /app/backend
RUN go mod download

WORKDIR /app
COPY backend ./backend
COPY infra/scripts ./infra/scripts
WORKDIR /app/backend

# Stage 2: Build
FROM deps AS builder
# TARGETARCH 由 buildx 按当前正在构建的那一路注入（amd64 / arm64）。
# CGO 关着，所以纯交叉编译，不需要任何目标架构的工具链。
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=linux
RUN --mount=type=cache,target=/root/.cache/go-build \
    GOARCH=$TARGETARCH go build \
    -trimpath \
    -ldflags='-s -w' \
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
WORKDIR /app

# ca-certificates + docker-cli (legacy skill sandbox).
# bubblewrap + node + python3: the MCP-plugin sandbox. The main process launches
# third-party MCP servers via `bwrap` (an isolation env, no image) — the server
# code rides a mounted dir, but the interpreters live here in the host image and
# bwrap bind-mounts them read-only into the sandbox.
RUN apk add --no-cache ca-certificates docker-cli bubblewrap nodejs npm python3

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
