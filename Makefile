# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build + test。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 子项目的具体 lint 链在各自的 Makefile / package.json 里定义。
# 没装依赖（node_modules 不存在）或没 src 的子项目自动 skip，便于早期
# 增量开发时 lefthook 不被未启用的子项目卡住。

.PHONY: lint backend-lint app-lint sdk-lint e2e-lint env-lint
.PHONY: dev dev-up dev-down build clean test sdk-build app-build sqlc-gen

# ── lint ────────────────────────────────────────────────────────
# 顺序：env-lint 最快，先跑；backend 的 make lint 链已经很丰富；前端
# 各自跑 eslint + tsc + knip。
lint: env-lint backend-lint app-lint sdk-lint e2e-lint

env-lint:
	@LINT_ENV_EXCLUDE="standmeet-client standmeet-server standmeet-e2e" \
	  infra/scripts/lint-env "$$(pwd)"

backend-lint:
	@$(MAKE) -C backend lint

# 前端子项目：node_modules 没装就 skip（启用时再 pnpm install）。
app-lint:
	@if [ -d app/node_modules ] && [ -f app/package.json ]; then \
	  cd app && pnpm lint; \
	else \
	  echo "[skip] app/ has no node_modules or package.json — skipping"; \
	fi

sdk-lint:
	@if [ -d sdk/packages/core/node_modules ]; then \
	  cd sdk && pnpm -r lint; \
	else \
	  echo "[skip] sdk/ has no node_modules — skipping"; \
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

# sdk-build —— 让 sdk-core/sdk/embed 三包都 tsup 出 dist/ 给 app dogfood。
# app-build 之前先跑 sdk-build，让 Next 编译时能找到 @standmeet/sdk-core/dist。
sdk-build:
	@pnpm -F @standmeet/sdk-core build
	@pnpm -F @standmeet/sdk build
	@pnpm -F @standmeet/embed build

# app-build —— host 上 pnpm build，生成 .next/standalone 让 docker 镜像 COPY。
# 选择 host build 而非 docker build：node:22-alpine 里 pnpm install 走 npm
# registry 经常 < 50 KiB/s（macOS docker desktop 网络栈瓶颈），host 上 14s 完事。
app-build: sdk-build
	@pnpm install --frozen-lockfile
	@pnpm -F standmeet-app build

dev-up: app-build
	@docker compose -f docker-compose.dev.yml up -d --build
	@echo "[dev] app=http://localhost:3000 backend=http://localhost:8000"

dev-down:
	@docker compose -f docker-compose.dev.yml down --remove-orphans

build:
	@echo "[build] not implemented yet."

# sqlc-gen —— regenerate Go query bindings from db/queries/*.sql + db/schema.sql.
# Pinned to v1.20.0 inside the official sqlc docker image. Newer sqlc (1.31+)
# changed initialism handling (AIProvider → AiProvider), which is a non-trivial
# rename across owners.sql.go / page_content.sql.go etc — upgrade is a
# separate PR. Until then this target is the only sanctioned way to regen
# dbq locally (host installs may pull a newer version).
#
# After running, diff backend/internal/postgres/dbq/ and commit the new files.
sqlc-gen:
	@docker run --rm \
		-v $(PWD)/backend:/src \
		-w /src \
		sqlc/sqlc:1.20.0 generate
	@echo "[sqlc] regenerated. diff & commit backend/internal/postgres/dbq/"

# test —— 一键跑 e2e：先 dev-up（含 SDK build → app build → docker compose
# --build --wait 增量 rebuild 改了的 service），再 playwright。conversation
# 里跑 e2e 就一条 `make test`，不要分步。
test: dev-up
	@cd e2e && pnpm exec playwright test

# setup-token —— demo 时 owner 打开 / 自动 redirect 到 /setup?t=...；这个
# target 直接打印 path 让 operator 复制（boot banner 已经打过一次但可能
# 被后续日志冲掉）。e2e 不需要 —— fixtures/instance.findSetupToken 已经走
# 同样的 /api/v1/instance fetch。
setup-token:
	@curl -sS http://localhost:8000/api/v1/instance | jq -r '"setup path: /setup?t=" + .setup_token'

clean:
	@docker compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true
