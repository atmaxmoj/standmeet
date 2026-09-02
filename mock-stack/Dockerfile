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

FROM deps AS build-fault-proxy
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/fault-proxy ./fault-proxy

# ----- runtime: job-board ------------------------------------------------
FROM alpine:3.21 AS job-board
WORKDIR /app
# ca-certificates —— this mock signs a certificate on the fly and merges "the system roots + it" into
# one bundle for consumers (see job-board/tls.go). Without the system roots, there's nothing to merge into.
#
# /mock-tls is created and chowned in the image itself —— **a named volume inherits the owner of that
# path from the image on its first mount**. Without creating it, the volume would be root:root, and this
# process runs as uid 1001, so it would fail on startup with "permission denied".
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

# ----- runtime: fault-proxy (fault injector in front of ANY real upstream) --
# Division of labor with llm-gateway: llm-gateway **replaces** the model (scripted, for dev/e2e); this
# one **does not replace** anything, it forwards to the real upstream and only injects rate-limit /
# truncation / failure states. A real-environment audit needs to see how the real thing behaves under
# faults; swapping in a script would swap out the thing under test. Which upstream it is comes from
# UPSTREAM_BASE_URL —— either an LLM provider or this instance's own backend works, same image.
# ca-certificates —— the upstream may be https.
FROM alpine:3.21 AS fault-proxy
WORKDIR /app
RUN apk add --no-cache wget ca-certificates                                    \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=build-fault-proxy --chown=mock:mock /out/fault-proxy /app/fault-proxy
USER mock
EXPOSE 9500
ENV PORT=9500
ENTRYPOINT ["/app/fault-proxy"]

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
