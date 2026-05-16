FROM node:22-slim

# Install Claude Code CLI (required by @anthropic-ai/claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code --legacy-peer-deps

# Install Docker CLI for sandbox script execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Run as non-root user (Claude Code refuses --dangerously-skip-permissions as root)
# Add appuser to docker group for sandbox access
RUN useradd -m appuser && chown -R appuser:appuser /app \
    && (groupadd -f docker || true) && usermod -aG docker appuser
USER appuser

EXPOSE 8001

CMD ["npx", "tsx", "src/index.ts"]
