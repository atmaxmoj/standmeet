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

# ----- runtime: job-board ------------------------------------------------
FROM alpine:3.21 AS job-board
WORKDIR /app
RUN apk add --no-cache wget                                                   \
 && addgroup --system --gid 1001 mock                                         \
 && adduser --system --uid 1001 --ingroup mock mock
COPY --from=build-job-board --chown=mock:mock /out/job-board /app/job-board
USER mock
EXPOSE 9000
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
