# StandMeet web app —— minimal runtime image.
#
# Build runs on the host (pnpm install + pnpm build); Docker only holds the runtime.
# This avoids the slow npm registry network inside the container (measured 30 KiB/s).
#
# Workflow:
#   1. host runs `pnpm install && pnpm run build` (the Makefile's app-build target)
#   2. docker compose build app — only COPYs the already-built .next/standalone
#
# Equivalent to "build artifact → image", like a Go binary image.

FROM node:22-alpine
# ghcr → repo linkage: GitHub reads this to list the pushed image under the repo's Packages.
LABEL org.opencontainers.image.source="https://github.com/atmaxmoj/standmeet"
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# With outputFileTracingRoot set to the workspace root, .next/standalone's
# internal layout is `<workspace>/app/server.js` + `<workspace>/node_modules/.pnpm/...`.
# The whole standalone tree is used as /app, with server.js under the app/ subdir.
COPY --chown=nextjs:nodejs .next/standalone ./
COPY --chown=nextjs:nodejs .next/static ./app/.next/static
COPY --chown=nextjs:nodejs public ./app/public
USER nextjs
WORKDIR /app/app
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
