# Stage 1: Lint
#
# 跑同 lefthook pre-commit 一样的 `make lint` 链。作为部署门 ——
# 失败这里就出不了 binary，CI / Coolify 没东西可发。本地 commit 已经
# 被 lefthook 拦过一次，但 --no-verify 能绕过，所以这里是第二道墙。
# 形态对齐 Otium auth 的 Dockerfile。
#
# Cacheable: BuildKit 复用 apk + go install 层；只有 source code 变了
# 才重跑 `make lint`。
FROM golang:1.26-alpine AS lint
WORKDIR /app

# bash + make 给 Makefile 用；git 给 `go install` 用。
# gitleaks 不在这里装 —— `make lint` 的 secrets target 对它的缺失友好
# （soft-skip + 消息）。
RUN apk add --no-cache git bash make

# Lint 工具链。版本 @latest 跟 dev 环境同步；如果以后要 reproducible
# build，再 pin 到具体 tag。
RUN go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest \
 && go install github.com/fe3dback/go-arch-lint@latest \
 && go install github.com/fzipp/gocyclo/cmd/gocyclo@latest \
 && go install github.com/maxpoletaev/go-escape-lint@latest
ENV PATH="/root/go/bin:${PATH}"

# 依赖先下，让 `go mod download` 这层独立缓存。
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN make lint

# Stage 2: Build
#
# 继承自 `lint`，BuildKit 只在 lint 通过后才到这阶段 —— 没有 lint 失败
# 但 build 成功并存的尴尬情况。
FROM lint AS builder

# CGO_ENABLED=0 + linux 目标 = 静态二进制，alpine 阶段直接 cp。GOARCH 不
# 写死，让 buildx 按目标平台决定（Coolify amd64 / Apple Silicon arm64），
# 写死 amd64 会让 Apple Silicon 走 emulation。
# -trimpath 抹路径前缀；-s -w 去 debug info；镜像更小、信息泄漏少。
ENV CGO_ENABLED=0 GOOS=linux
RUN go build \
    -trimpath \
    -ldflags='-s -w' \
    -o /out/standmeet \
    ./cmd/server

# Stage 3: Production
FROM alpine:3.21 AS production
WORKDIR /app

# ca-certificates 让 outbound TLS（Anthropic / OpenAI / Caddy ask）能
# 验证证书；docker-cli 给 sandbox 用 (mount /var/run/docker.sock 时调
# `docker run --rm --network=none` 跑 owner-curated skill 脚本)。
# 不装 docker-cli 时 sandbox 报 ErrDisabled，对应 SANDBOX_DRIVER!=docker。
RUN apk add --no-cache ca-certificates docker-cli

RUN addgroup --system --gid 1001 standmeet && \
    adduser --system --uid 1001 --ingroup standmeet standmeet

COPY --from=builder --chown=standmeet:standmeet /out/standmeet /app/standmeet
# Schema 应用在 db service (docker-entrypoint-initdb.d)，binary 容器里
# 不再需要 goose / migrations 文件。
COPY --from=builder --chown=standmeet:standmeet /app/entrypoint.sh /app/entrypoint.sh
# /srv/first-run.txt 是 setup token 落地点；声明为 volume 不必要，确保
# /srv 目录存在且 standmeet user 可写。
RUN mkdir -p /srv && chown standmeet:standmeet /srv

USER standmeet

EXPOSE 8000
ENV PORT=8000
ENV HOST=0.0.0.0

ENTRYPOINT ["/app/entrypoint.sh"]

# Stage 4: Mock (test-only HTTP server for e2e)
#
# job-board-mock serves captured Greenhouse / Lever / Ashby / RemoteOK /
# WWR / HN fixtures so e2e doesn't hit the real internet. Built from the
# same source tree as the production binary; alpine-final image is tiny
# (~10 MiB) since it's just one Go static binary + ca-certificates.
FROM golang:1.26-alpine AS mock-builder
WORKDIR /app
ENV CGO_ENABLED=0 GOOS=linux
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/job-board-mock ./cmd/job-board-mock

FROM alpine:3.21 AS mock
WORKDIR /app
RUN apk add --no-cache wget                                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=mock-builder --chown=mock:mock /out/job-board-mock /app/job-board-mock
USER mock
EXPOSE 9000
ENV PORT=9000
ENV FIXTURES_DIR=/fixtures
ENTRYPOINT ["/app/job-board-mock"]

# Stage 5: MCP-server-mock (e2e fixture)
#
# 等价 job-board-mock 但跑 cmd/mcp-server-mock —— e2e 用作"owner 注册的
# 外部 MCP server" 的对端。
FROM golang:1.26-alpine AS mcp-mock-builder
WORKDIR /app
ENV CGO_ENABLED=0 GOOS=linux
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/mcp-server-mock ./cmd/mcp-server-mock

FROM alpine:3.21 AS mcp-mock
WORKDIR /app
RUN apk add --no-cache wget                                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=mcp-mock-builder --chown=mock:mock /out/mcp-server-mock /app/mcp-server-mock
USER mock
EXPOSE 9100
ENV PORT=9100
ENTRYPOINT ["/app/mcp-server-mock"]
