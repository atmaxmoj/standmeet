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
# 写死 amd64 会让 M1/M2 走 emulation。
# -trimpath 抹路径前缀；-s -w 去 debug info；镜像更小、信息泄漏少。
ENV CGO_ENABLED=0 GOOS=linux
RUN go build \
    -trimpath \
    -ldflags='-s -w' \
    -o /out/standmeet \
    ./cmd/server

# 装 goose binary（migration runner）。
# 用 prebuilt release 避免 go install 拉一堆 DB 驱动（pgsql / mysql / mssql /
# clickhouse / sqlite / ydb / vertica / libsql …），那需要 ~1 分钟下载 + compile。
# prebuilt 直接是 ~10MB 静态 amd64/arm64 binary。
ARG TARGETARCH
ARG GOOSE_VERSION=v3.27.1
RUN apk add --no-cache wget \
 && wget -qO /out/goose "https://github.com/pressly/goose/releases/download/${GOOSE_VERSION}/goose_linux_${TARGETARCH}" \
 && chmod +x /out/goose

# Stage 3: Production
FROM alpine:3.21 AS production
WORKDIR /app

# ca-certificates 让 outbound TLS（Anthropic / OpenAI / Caddy ask）能
# 验证证书。
RUN apk add --no-cache ca-certificates

RUN addgroup --system --gid 1001 standmeet && \
    adduser --system --uid 1001 --ingroup standmeet standmeet

COPY --from=builder --chown=standmeet:standmeet /out/standmeet /app/standmeet
COPY --from=builder --chown=standmeet:standmeet /out/goose /app/goose
# Migrations + entrypoint 跟着镜像走，启动时 goose up（见 entrypoint.sh）。
COPY --from=builder --chown=standmeet:standmeet /app/db/migrations /app/db/migrations
COPY --from=builder --chown=standmeet:standmeet /app/entrypoint.sh /app/entrypoint.sh
# /srv/first-run.txt 是 setup token 落地点；声明为 volume 不必要，确保
# /srv 目录存在且 standmeet user 可写。
RUN mkdir -p /srv && chown standmeet:standmeet /srv

USER standmeet

EXPOSE 8000
ENV PORT=8000
ENV HOST=0.0.0.0

ENTRYPOINT ["/app/entrypoint.sh"]
