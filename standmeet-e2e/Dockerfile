# Stage 1: Build standmeet-client
FROM node:22-slim AS client-builder
WORKDIR /build
COPY standmeet-client/package.json standmeet-client/package-lock.json ./
RUN npm ci
COPY standmeet-client/ .
RUN npx vite build

# Stage 2: Test runner
FROM mcr.microsoft.com/playwright:v1.50.0-noble

RUN apt-get update && apt-get install -y xvfb x11-utils dbus-x11 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install test dependencies (includes electron + playwright)
COPY standmeet-e2e/package.json standmeet-e2e/package-lock.json* ./
RUN npm ci

# Copy built standmeet-client (only needed files)
COPY --from=client-builder /build/package.json /app/standmeet-client/package.json
COPY --from=client-builder /build/dist-electron /app/standmeet-client/dist-electron
COPY --from=client-builder /build/dist-renderer /app/standmeet-client/dist-renderer

# Copy test code
COPY standmeet-e2e/ .

CMD ["sh", "-c", "xvfb-run npx playwright test --project=${PLAYWRIGHT_PROJECT:-mock} ${PLAYWRIGHT_FILE:+tests/$PLAYWRIGHT_FILE}"]
