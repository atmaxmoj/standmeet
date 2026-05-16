# StandMeet

AI-powered personal introduction platform. Owners share their info, visitors learn about them through AI conversation.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- A [Claude Code OAuth token](https://console.anthropic.com/) (for Invitation Mode AI)

### Deploy

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env and fill in the values

# 2. Start all services
docker compose up -d
```

Services will be available at:
- **Web UI**: http://localhost:3000
- **API**: http://localhost:8000
- **Gateway WebSocket**: ws://localhost:8001

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token for AI conversations |
| `DJANGO_SECRET_KEY` | Django secret key (generate a random string) |
| `OWNER_TOKEN` | Owner authentication token (auto-generated on first run if not set) |

## Development

```bash
# Start dev environment (with hot reload)
make dev

# Populate demo data
make populate

# Run all tests
make test

# Stop dev environment
make dev-down
```

## Architecture

| Directory | Tech | Port |
|-----------|------|------|
| `server/` | Python/Django + PostgreSQL + DRF + FastMCP | 8000 |
| `gateway/` | Node.js + Claude Agent SDK + WebSocket | 8001 |
| `web/` | Next.js 15 + React 19 | 3000 |
