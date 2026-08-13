# mock-stack/Dockerfile —— builds the three e2e/dev mock services
# (job-board, mcp, llm-gateway) as separate stages off one shared Go
# module. backend/Dockerfile no longer carries any mock stages — this
# repo's hygiene rule says backend/ contains only production code.
#
# Stage names are referenced by docker-compose.dev.yml `target:` keys.

FROM golang:1.26-alpine AS deps
WORKDIR /src
ENV CGO_ENABLED=0 GOOS=linux
COPY go.mod go.sum ./
RUN go mod download

FROM deps AS build-job-board
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/job-board ./job-board

FROM deps AS build-mcp
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/mcp-server-mock ./mcp

FROM deps AS build-llm-gateway
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/llm-gateway ./llm-gateway

FROM deps AS build-mail
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/mail ./mail

FROM deps AS build-llm-fault-proxy
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/llm-fault-proxy ./llm-fault-proxy

# ----- runtime: job-board ------------------------------------------------
FROM alpine:3.21 AS job-board
WORKDIR /app
# ca-certificates —— 这个 mock 会现签一张证书,并把"系统根 + 它"合并成一份 bundle
# 给消费方(见 job-board/tls.go)。没有系统根就合并不出来。
#
# /mock-tls 在镜像里就建好并 chown —— **命名卷第一次挂载时继承镜像里该路径的属主**。
# 不建的话卷是 root:root,而这个进程跑 uid 1001,启动即 "permission denied"。
RUN apk add --no-cache wget ca-certificates                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock                           \
 && mkdir -p /mock-tls && chown mock:mock /mock-tls
COPY --from=build-job-board --chown=mock:mock /out/job-board /app/job-board
USER mock
EXPOSE 9000 9443
ENV PORT=9000
ENV FIXTURES_DIR=/fixtures
ENTRYPOINT ["/app/job-board"]

# ----- runtime: mcp ------------------------------------------------------
FROM alpine:3.21 AS mcp
WORKDIR /app
RUN apk add --no-cache wget                                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=build-mcp --chown=mock:mock /out/mcp-server-mock /app/mcp-server-mock
USER mock
EXPOSE 9100
ENV PORT=9100
ENTRYPOINT ["/app/mcp-server-mock"]

# ----- runtime: llm-gateway ----------------------------------------------
FROM alpine:3.21 AS llm-gateway
WORKDIR /app
RUN apk add --no-cache wget                                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=build-llm-gateway --chown=mock:mock /out/llm-gateway /app/llm-gateway
USER mock
EXPOSE 9300
ENV PORT=9300
ENTRYPOINT ["/app/llm-gateway"]

# ----- runtime: llm-fault-proxy (fault injector in front of a REAL provider) --
# 跟 llm-gateway 的分工:llm-gateway **替换**模型(脚本化,给 dev/e2e);这个**不替换**,它转发到
# 真 provider,只注入限流/截断。真实环境审计要看真模型在异常下怎么走,换成脚本就把被测对象换掉了。
# ca-certificates —— 上游是 https。
FROM alpine:3.21 AS llm-fault-proxy
WORKDIR /app
RUN apk add --no-cache wget ca-certificates                                    \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=build-llm-fault-proxy --chown=mock:mock /out/llm-fault-proxy /app/llm-fault-proxy
USER mock
EXPOSE 9500
ENV PORT=9500
ENTRYPOINT ["/app/llm-fault-proxy"]

# ----- runtime: mail (SMTP fault mock in front of mailpit) ----------------
FROM alpine:3.21 AS mail
WORKDIR /app
RUN apk add --no-cache wget                                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=build-mail --chown=mock:mock /out/mail /app/mail
USER mock
EXPOSE 9400 1025
ENV PORT=9400
ENTRYPOINT ["/app/mail"]
