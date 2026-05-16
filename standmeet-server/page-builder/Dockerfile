FROM node:22-slim

WORKDIR /app

# Install sandbox-runtime dependencies (bubblewrap, socat, ripgrep for Linux sandboxing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap socat ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install base dependencies
COPY package.json ./
RUN npm install --production=false && npm cache clean --force

# Install sandbox-runtime CLI globally (optional — gracefully skipped if unavailable)
RUN npm install -g @anthropic-ai/sandbox-runtime 2>/dev/null || echo "srt not available, builds will run unsandboxed"

# Copy components library, configs, and build/server scripts
COPY components/ ./components/
COPY vite.config.ts tsconfig.json build.mjs build-server.mjs ./
COPY template/ ./template/

# Copy dev mode entry files
COPY index.html entry-dev.tsx ./

# Copy start script
COPY start.sh ./
RUN chmod +x start.sh

# Create workspace and source directories
RUN mkdir -p /workspace/source /workspace/data /workspace/dist /workspace/dist-ssr \
    && mkdir -p /app/source /tmp

CMD ["node", "build.mjs"]
