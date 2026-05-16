DEV_COMPOSE := docker compose -p standmeet-dev -f standmeet-server/docker-compose.dev.yml

.PHONY: dev dev-up dev-down clean test test-real test-all populate build lint

# Dev environment — 一键启动，自动清理旧容器 + 旧项目名
dev:
	@$(DEV_COMPOSE) down --remove-orphans 2>/dev/null || true
	@docker compose -p standmeet-server -f standmeet-server/docker-compose.dev.yml down --remove-orphans 2>/dev/null || true
	$(DEV_COMPOSE) up --build

dev-up:
	@$(DEV_COMPOSE) down --remove-orphans 2>/dev/null || true
	@docker compose -p standmeet-server -f standmeet-server/docker-compose.dev.yml down --remove-orphans 2>/dev/null || true
	$(DEV_COMPOSE) up --build -d
	@echo "Dev environment ready: server=8000 gateway=8001 web=3000"

dev-down:
	$(DEV_COMPOSE) down --remove-orphans

# Tests — 一键跑全部，可指定文件: make test FILE=layout.test.ts
test:
	$(MAKE) -C standmeet-e2e test FILE=$(FILE)

test-real:
	$(MAKE) -C standmeet-e2e test-real

test-all:
	$(MAKE) -C standmeet-e2e test-all

# Demo data — reads IM tokens from .env and passes to container
populate:
	set -a && . standmeet-server/.env && set +a && \
	$(DEV_COMPOSE) exec \
		-e DISCORD_BOT_TOKEN="$$DISCORD_BOT_TOKEN" \
		-e DISCORD_APPLICATION_ID="$$DISCORD_APPLICATION_ID" \
		-e TELEGRAM_BOT_TOKEN="$$TELEGRAM_BOT_TOKEN" \
		server uv run python manage.py populate_demo

# Build verification
build:
	cd standmeet-client && npx tsc --noEmit
	cd standmeet-server/frontend && npx tsc --noEmit
	$(DEV_COMPOSE) build

# Lint — all sub-projects
lint:
	cd standmeet-client && npm run lint
	cd standmeet-e2e && npm run lint
	cd standmeet-server/gateway && npm run lint
	cd standmeet-server/frontend && npm run lint
	cd standmeet-server/im-bridge && npm run lint
	cd standmeet-server/page-builder && npm run lint
	cd standmeet-server/backend && python3 -m ruff check .
	cd standmeet-client && npx knip
	cd standmeet-e2e && npx knip
	cd standmeet-server/gateway && npx knip
	cd standmeet-server/frontend && npx knip
	cd standmeet-server/im-bridge && npx knip
	cd standmeet-server/page-builder && npx knip

# Clean everything (including volumes)
clean:
	$(DEV_COMPOSE) down -v --remove-orphans 2>/dev/null || true
	docker compose -p standmeet-test -f standmeet-e2e/docker-compose.test.yml down -v --remove-orphans 2>/dev/null || true
