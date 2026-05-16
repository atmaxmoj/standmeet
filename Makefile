# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build + test。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 子项目的具体 lint 链在各自的 Makefile / package.json 里定义。
# 没装依赖（node_modules 不存在）或没 src 的子项目自动 skip，便于早期
# milestone 增量开发时 lefthook 不被未启用的子项目卡住。

.PHONY: lint backend-lint app-lint sdk-lint e2e-lint env-lint
.PHONY: dev dev-up dev-down build clean test

# ── lint ────────────────────────────────────────────────────────
# 顺序：env-lint 最快，先跑；backend 的 make lint 链已经很丰富；前端
# 各自跑 eslint + tsc + knip。
lint: env-lint backend-lint app-lint sdk-lint e2e-lint

env-lint:
	@LINT_ENV_EXCLUDE="standmeet-client standmeet-server standmeet-e2e" \
	  infra/scripts/lint-env "$$(pwd)"

backend-lint:
	@$(MAKE) -C backend lint

# 前端子项目：node_modules 没装就 skip（M7/M11 真启用时再 pnpm install）。
app-lint:
	@if [ -d app/node_modules ] && [ -f app/package.json ]; then \
	  cd app && pnpm lint; \
	else \
	  echo "[skip] app/ has no node_modules or package.json — skipping (will activate at M7)"; \
	fi

sdk-lint:
	@if [ -d sdk/packages/core/node_modules ]; then \
	  cd sdk && pnpm -r lint; \
	else \
	  echo "[skip] sdk/ has no node_modules — skipping (will activate at M11)"; \
	fi

e2e-lint:
	@if [ -d e2e/node_modules ]; then \
	  cd e2e && pnpm lint; \
	else \
	  echo "[skip] e2e/ has no node_modules — skipping"; \
	fi

# ── dev / build / test ──────────────────────────────────────────
dev:
	@docker compose -f docker-compose.dev.yml up

dev-up:
	@docker compose -f docker-compose.dev.yml up -d
	@echo "[dev] backend=http://localhost:8000 db=:5432 redis=:6379"

dev-down:
	@docker compose -f docker-compose.dev.yml down --remove-orphans

build:
	@echo "[build] not implemented yet."

# test 跑 e2e；预期 dev stack 已通过 dev-up 起来。
test:
	@cd e2e && pnpm exec playwright test

clean:
	@docker compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true
