# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build + test。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 子项目的具体 lint 链在各自的 Makefile / package.json 里定义。
# 没装依赖（node_modules 不存在）或没 src 的子项目自动 skip，便于早期
# 增量开发时 lefthook 不被未启用的子项目卡住。

.PHONY: lint backend-lint backend-no-mock app-lint sdk-lint e2e-lint env-lint
.PHONY: dev dev-up dev-rebuild dev-down build clean test test-fresh test-only sdk-build app-build sqlc-gen gateway-up eval-smoke eval-interview

# ── lint ────────────────────────────────────────────────────────
# 顺序：env-lint 最快，先跑；backend 的 make lint 链已经很丰富；前端
# 各自跑 eslint + tsc + knip。backend-no-mock 是 G-Y 强制的"backend 不
# 准含 mock-only 代码"约束。
lint: env-lint backend-lint backend-no-mock app-lint sdk-lint e2e-lint

env-lint:
	@LINT_ENV_EXCLUDE="standmeet-client standmeet-server standmeet-e2e" \
	  infra/scripts/lint-env "$$(pwd)"

backend-lint:
	@$(MAKE) -C backend lint

# backend-no-mock —— G-Y 守门：backend/ 里禁止任何 mock-only / test-only
# 代码 (MockProvider / INFERENCE_MOCK_ env / /__mock URL / routes/sys/test_*)。
# mock infra 整套去 mock-stack/。grep 排除 _test.go 跟 // 注释。
#
# 检查清单：
#   1. 源码模式：MockProvider / INFERENCE_MOCK_ / __mock / TestRegistry /
#      TestVisitorCap / TestGCalExpire
#   2. 目录：backend/cmd/{job-board,mcp-server}-mock/ (应该在 mock-stack/)
#   3. 文件：backend/internal/routes/sys/test_*.go (应该走 mock-stack admin
#      端点 或 spec 直接打 SQL/Redis)
backend-no-mock:
	@infra/scripts/check-no-mock

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
	@pnpm -F @standmeet/agent-core build
	@pnpm -F @standmeet/sdk build
	@pnpm -F @standmeet/embed build
	@pnpm -F @standmeet/mcp-client build

# app-build —— host 上 pnpm build，生成 .next/standalone 让 docker 镜像 COPY。
# 选择 host build 而非 docker build：node:22-alpine 里 pnpm install 走 npm
# registry 经常 < 50 KiB/s（macOS docker desktop 网络栈瓶颈），host 上 14s 完事。
app-build: sdk-build
	@pnpm install --frozen-lockfile
	@pnpm -F standmeet-app build

dev-up: app-build
	@docker compose -f docker-compose.dev.yml up -d --build --wait
	@echo "[dev] app=http://localhost:3000 backend=http://localhost:8000"

# gateway-up —— 只起 llm-gateway sidecar (eval-smoke 用)，不跑 app-build /
# 整栈。Anthropic-compat mock，host :9300，确定性脚本回复。
gateway-up:
	@docker compose -f docker-compose.dev.yml up -d --wait llm-gateway

# eval-smoke —— eval-harness 独立调用 smoke：证明 backend agentic core
# (经 agentcore facade) 能被 backend 进程外的独立 module 调起来 + 完整
# tool round-trip。起 llm-gateway → eval-harness/smoke.sh (build + 排队
# 确定性 tool+reply + 跑二进制 + 断言 transcript)。
eval-smoke: gateway-up
	@eval-harness/smoke.sh

# eval-interview —— 跑一整场模拟面试 (主场景):一个 LLM 面试官 ×N 轮追问
# 被测 agent (用 Marcus Chen persona 的 voice + 真检索其 corpus 作答),观测
# 对话质量。**需真 LLM** —— 设 EVAL_* 指向真 provider:
#   EVAL_PROVIDER=deepseek EVAL_ENDPOINT=https://api.deepseek.com \
#   EVAL_MODEL=deepseek-chat EVAL_KEY=sk-... make eval-interview EXCHANGES=14
# 不设 EVAL_* 则打 mock gateway,只验循环结构 (内容是 mock 占位,无质量意义)。
eval-interview:
	@cd eval-harness && go build -o /tmp/eval-harness . && \
	  /tmp/eval-harness --interview \
	    --corpus fixtures/personas/marcus-chen \
	    --role "$${ROLE:-senior backend engineer}" \
	    --exchanges "$${EXCHANGES:-12}"

# dev-rebuild —— 改 backend / app 代码后强制 rebuild + recreate 指定服务，
# 不动 db/redis/minio (保数据)。用法：make dev-rebuild SVC=app
dev-rebuild: app-build
	@test -n "$(SVC)" || (echo "usage: make dev-rebuild SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml up -d --build --wait --force-recreate --no-deps $(SVC)

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

# test-fresh —— 跟 test 一样，但先 clean (down -v) 让 db volume 重建从 schema.sql
# 重新 apply。schema 改过 (db/schema.sql) 必须用这个；纯代码改用 `make test`。
test-fresh: clean test

# test-only —— 只跑一个 spec / 一个 grep 模式。隔离 reproducer 用。
# usage:   make test-only SPEC=blog-posts
#          make test-only SPEC=blog-posts GREP="MCP post_create"
test-only: dev-up
	@test -n "$(SPEC)" || (echo "usage: make test-only SPEC=<spec-name> [GREP=<title pattern>]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)")

# setup-token —— demo 时 owner 打开 / 自动 redirect 到 /setup?t=...；这个
# target 直接打印 path 让 operator 复制（boot banner 已经打过一次但可能
# 被后续日志冲掉）。e2e 不需要 —— fixtures/instance.findSetupToken 已经走
# 同样的 /api/v1/instance fetch。
setup-token:
	@curl -sS http://localhost:8000/api/v1/instance | jq -r '"setup path: /setup?t=" + .setup_token'

# password-reset —— 紧急 owner 忘记密码兜底。docker exec 跑 standmeet 二进制
# 的 password-reset 子命令：连 DB → 颁发一次性 reset token → stdout 打印
# plaintext + URL。30min TTL，一次性。owner 拷 URL 进浏览器改密码。
password-reset:
	@docker compose -f docker-compose.dev.yml exec backend /app/standmeet password-reset

clean:
	@docker compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true

# capture-marketplace-fixtures —— refresh the GitHub anthropics/skills
# snapshot. SkillsMP is hand-rolled (no real upstream); see
# e2e/fixtures/marketplace/README.md.
capture-marketplace-fixtures:
	@bash e2e/fixtures/marketplace/capture.sh

# trim-marketplace-fixtures —— write captured .raw/ into the committed
# fixture path (drops fields we don't read).
trim-marketplace-fixtures:
	@bash e2e/fixtures/marketplace/trim.sh
