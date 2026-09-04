# updater — the product-owned upgrade adapter, a small Go binary that talks to the Docker socket via
# the Docker SDK (no docker CLI needed anymore). Multi-stage: build static, ship tiny.
#
# Built with the repo root as context (release: `-f infra/updater/Dockerfile .`).
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY infra/updater/go.mod infra/updater/go.sum ./
RUN go mod download
COPY infra/updater/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /updater .

FROM alpine:3.20
COPY --from=build /updater /usr/local/bin/updater
ENTRYPOINT ["/usr/local/bin/updater"]
