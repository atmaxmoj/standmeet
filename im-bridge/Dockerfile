# im-bridge —— the IM bridge.
#
# It's an **external visitor client** for this instance: holds an access code, opens a
# conversation, sends a turn —— same path a browser would take. So the image needs none of
# the backend, just node + this package + its dependencies.
#
# Uses **long polling** (see src/main.ts), so this container listens on no port and needs no
# public inbound entry point.

FROM node:22-alpine AS build
WORKDIR /app

# pnpm workspace: the bridge depends on @standmeet/sdk-core (workspace:*), so it needs to
# be included.
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY sdk/packages/core sdk/packages/core
COPY im-bridge im-bridge
RUN pnpm install --filter @standmeet/im-bridge... --frozen-lockfile
# **sdk-core must be built inside the image**: its package.json points at dist/, and dist/
# is not part of the build context (bringing it in would risk "what runs in the image isn't
# the same as what's in the repo"). Skip this step and the container blows up on the import
# line —— while tsx runs fine locally, because the local machine has dist.
RUN pnpm -F @standmeet/sdk-core build

FROM node:22-alpine
# ghcr → repo linkage: GitHub reads this to list the pushed image under the repo's Packages.
LABEL org.opencontainers.image.source="https://github.com/atmaxmoj/standmeet"
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
WORKDIR /app/im-bridge
# tsx runs TS directly: this service is too small to be worth another build-output layer.
# Installed as a dependency rather than `npx`-fetched on the fly —— the image needs to boot
# offline.
CMD ["npx", "--no-install", "tsx", "src/main.ts"]
