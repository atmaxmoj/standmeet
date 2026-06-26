# syntax=docker/dockerfile:1
# The backend imports NO plugin code: mcp-servers/* are pure runtime artifacts
# (static binaries built by infra/plugins/provision.sh, bind-mounted in dev /
# materialized from object storage in prod — #135). The host↔plugin contract is
# the manifest + the runtime MCP protocol, never a Go dependency. So this image
# is backend-only; the build context stays repo-root (docker-compose: context: .)
# but nothing outside backend/ is copied here.

# Stage 1: Lint
#
# 跑同 lefthook pre-commit 一样的 `make lint` 链。作为部署门 —— 失败这里就出不了
# binary。Cacheable: BuildKit 复用 apk + go install + go mod download 层。
FROM golang:1.26-alpine AS lint
WORKDIR /app

RUN apk add --no-cache git bash make

RUN go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest \
 && go install github.com/fe3dback/go-arch-lint@latest \
 && go install github.com/fzipp/gocyclo/cmd/gocyclo@latest \
 && go install github.com/maxpoletaev/go-escape-lint@latest
ENV PATH="/root/go/bin:${PATH}"

# 依赖先下（独立缓存层）。backend 不再 import 任何 mcp-servers 模块，只需 backend 自己。
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /app/backend
RUN go mod download

# 全量源码 + lint。
WORKDIR /app
COPY backend ./backend
WORKDIR /app/backend
# 编译缓存挂成 BuildKit cache —— 源码改了 layer 会失效，但 eino 等依赖的 object
# 文件不变；持久化 GOCACHE + golangci cache 让每次只重编改过的包，不再冷编全树
# （这才是慢的真因，依赖 download 早在上面 go mod download 层缓存住了）。
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/root/.cache/golangci-lint \
    make lint

# Stage 2: Build
FROM lint AS builder
ENV CGO_ENABLED=0 GOOS=linux
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build \
    -trimpath \
    -ldflags='-s -w' \
    -o /out/standmeet \
    ./cmd/server

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

USER standmeet

EXPOSE 8000
ENV PORT=8000
ENV HOST=0.0.0.0

ENTRYPOINT ["/app/entrypoint.sh"]
