# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 各子项目的具体 lint 链在自己的 Makefile / package.json 里定义。

.PHONY: lint backend-lint app-lint sdk-lint e2e-lint env-lint
.PHONY: build dev clean test

# ── lint ────────────────────────────────────────────────────────
# 顺序：env-lint 最快，先跑；backend 的 make lint 链已经很丰富；前端
# 各自跑 eslint + tsc + knip。
lint: env-lint backend-lint app-lint sdk-lint e2e-lint

env-lint:
	@infra/scripts/lint-env "$$(pwd)"

backend-lint:
	@$(MAKE) -C backend lint

app-lint:
	@cd app && pnpm lint

sdk-lint:
	@cd sdk && pnpm -r lint

e2e-lint:
	@cd e2e && pnpm lint

# ── dev / build / test 等先 stub，待真起服务时填 ────────────────
dev:
	@echo "[dev] not implemented yet — bring up docker compose dev stack here."

build:
	@echo "[build] not implemented yet."

test:
	@cd e2e && pnpm test

clean:
	@docker compose down -v --remove-orphans 2>/dev/null || true
