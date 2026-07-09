# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build + test。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 子项目的具体 lint 链在各自的 Makefile / package.json 里定义。
# 没装依赖（node_modules 不存在）或没 src 的子项目自动 skip，便于早期
# 增量开发时 lefthook 不被未启用的子项目卡住。

.PHONY: lint backend-lint backend-test backend-no-mock app-lint sdk-lint e2e-lint env-lint
.PHONY: dev dev-up dev-rebuild dev-down prod-up prod-down build clean test test-fresh test-only sdk-build app-build sqlc-gen gateway-up eval-smoke eval-ghost eval-ask eval-compaction eval-doc-context eval-cross-conversation eval-interview eval-summary eval-capabilities eval-owner-mcp

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

# backend-test —— Go 单元/集成测试（testify，无 DB/docker）。e2e 走 `make test`。
backend-test:
	@$(MAKE) -C backend test

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
#   4. 具名 fixture/canned 替身 (P.13)
#   5. test-only 包 import (name-INDEPENDENT：testing/testify/httptest 漏进 prod)
# check-no-mock-test.sh 是 checker 的自测：种一个中性命名的 testify-import 违规，断言被抓。
backend-no-mock:
	@infra/scripts/check-no-mock
	@infra/scripts/check-no-mock-test.sh

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
	@infra/plugins/provision.sh
	@docker compose -f docker-compose.dev.yml up -d --build --wait
	@echo "[dev] app=http://localhost:3000 backend=http://localhost:8000"

# prod-up —— bring up the real production stack (self-contained: app + backend +
# db + redis + gotenberg + minio, no mocks). Reads .env (cp from .env.example).
# = dev minus the mocks, with real secrets. TLS/domain is external (front the
# app's published port with your proxy). Separate compose project + offset host
# ports so it coexists with the dev/test stack.
prod-up:
	@test -f .env || { echo "create .env first: cp .env.example .env && edit"; exit 2; }
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --build --wait
	@echo "[prod] app on http://localhost:38227 (front with your TLS proxy)"

prod-down:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml down

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

# eval-ask —— 给被测 agent (owner persona) 喂一个问题,看它怎么答 + 查了哪些
# corpus。被测对象 = owner 的 system prompt + corpus,真 LLM (DeepSeek v4-pro,
# harness 自读 .env)。面试官不是这里的 —— 面试官是 operator spawn 的 Claude
# agent,反复调这个 --ask 驱动多轮面试 + 对着 corpus 判 grounding。
#   echo '{"history":[],"question":"..."}' | make eval-ask
eval-ask:
	@cd eval-harness && go build -o /tmp/eval-harness . && \
	  /tmp/eval-harness --ask --persona fixtures/personas/marcus-chen

# eval-ghost —— Ghost steering judgment, deterministic eval: inject each ghost scenario's
# waypoints into the frozen RoleSnapshot, run the SAME prod loop via the agentcore facade,
# assert the emitted ghost hits gold (target_waypoint / silence). Steering judgment = the
# `assert` half; voice/coherence = `human` (read the transcript). Runs on the mock gateway
# (deterministic), no real LLM.
eval-ghost: gateway-up
	@eval-harness/ghost-test.sh

# eval-compaction —— 多轮 context 臃肿用例:构造 >32K token 长对话,断言 agent
# loop 的 summarization compaction 真触发 + 压缩后早期上下文召回完整。**需真
# LLM** (harness 自读 eval-harness/.env 的 DeepSeek key;没真 key 不会触发压缩)。
eval-compaction:
	@eval-harness/compaction-test.sh

# eval-doc-context —— #36 位置感知 / 指代解析用例:访客正读 Notification Pipeline
# 那篇,问「tell me more about this pipeline」(corpus 里有两条 pipeline,真歧义)。
# doc_context → 真 instructionWithDoc 注入 → 断言真模型把「this」解析成当前 doc(答
# Orbit 通知:token-bucket/fan-out),没串到 FlowPay 对账、没反问。**需真 LLM**
# (harness 自读 eval-harness/.env 的 DeepSeek key;mock gateway 不做指代解析会失败)。
eval-doc-context:
	@eval-harness/doc-context-test.sh

# eval-cross-conversation —— 「互通」用例:一个 member 多段独立对话,AI 能读到该 member
# 的全部对话。双向验引用质量:chat 里说的能在 wiki 浮窗下被 refer,反之亦然。两段「其他
# 对话」要点注进 instruction(镜像后端注入)→ 看真模型有没有跨对话连起来 + 答得诚实/grounded。
# **需真 LLM**(harness 自读 eval-harness/.env 的 DeepSeek key;mock gateway 跑了白跑)。
eval-cross-conversation:
	@eval-harness/cross-conversation-test.sh

# eval-subjectivity —— quality case: SUBJECTIVITY is subject-HOOD — being a SUBJECT (a first-person "I"
# judging FROM a lived standpoint), not an OBJECT (a person described from outside by attributes). Far
# more than tone, and more than a rich attribute list. Discriminative: same corpus + same question,
# three runs — subjectivity A (an outage), B (academia→a dropout shipping), and a no-subjectivity
# baseline (the OBJECT floor). A and B are built to reach OPPOSITE ship-timing conclusions; the judge
# reads the spine — does the persona speak AS the subject (first-person, from inside) or RECITE the
# person's attributes — plus divergent judgment, beyond-tone, and baseline contrast. Two failure modes:
# tone-collapse (costume) and the deeper object-collapse (a fluent narration ABOUT a person that never
# speaks AS one). **Needs a real LLM** (eval-harness/.env).
eval-subjectivity:
	@eval-harness/subjectivity-test.sh

# eval-interview —— 真跑一场多轮面试 (recruiter on code session,booking granted),
# 边跑边按维度标注:grounding / context retention / honest gap / not-in-corpus /
# privacy / tool use。透出每轮 agent 读了哪些 corpus + 答 + ghost hint,给人/judge
# agent 看质量、抖 prompt 破绽回填。**需真 LLM** (eval-harness/.env DeepSeek key)。
#   make eval-interview            # 默认 marcus-chen
#   EVAL_PERSONA=<dir> make eval-interview
eval-interview:
	@cd eval-harness && go build -o eval-harness-bin . && \
	  python3 interview.py

# eval-summary —— end-to-end eval of summarize_conversation on REAL DeepSeek. A
# recruiter drills into ONE point over several turns, asks for a written summary
# (captures the report HTML), then keeps asking follow-ups (which also guard the
# empty-assistant-message history bug — a post-summarize turn must still answer).
# An LLM judge scores the report; report HTML + a styled doc land in
# /tmp/sm-eval-summary for a human to open. **需真 LLM** (eval-harness/.env key)。
#   make eval-summary
#   EVAL_SUMMARY_DRILL=6 EVAL_SUMMARY_FOLLOWUPS=3 make eval-summary
eval-summary:
	@cd eval-harness && go build -o eval-harness-bin . && \
	  python3 summary.py

# eval-capabilities —— 留档的 agentic 能力套件。assert 类(booking/skill/mcp 真调了
# 没、deny 结构性缺席、隐私金丝雀漏没漏、ghost hint 有没有)硬判 PASS/FAIL;human 类
# (grounding/诚实/ambiguity/prompt 注入/ghost 质量/booking 失败)跑完留 transcript +
# 「LOOK FOR」给人/judge 看。mcp case 自动起 mock-stack/mcp,起不来则 SKIP(不静默)。
# **需真 LLM** (eval-harness/.env DeepSeek key)。
#   make eval-capabilities
#   EVAL_CASES=booking,skill,mcp make eval-capabilities   # 子集
eval-capabilities:
	@cd eval-harness && go build -o eval-harness-bin . && \
	  python3 capabilities.py

# eval-owner-mcp —— 当 agent 驱动 OWNER-side MCP server(inbound/ingest 那半,跟
# 访客出站对称)。走真 @standmeet/mcp-client Sigv1 stdio bridge,跑 me → raw_dump →
# list_recent_raw → promote_to_wiki → list_recent_wiki 闭环,机械 round-trip 断言。
# 需 dev stack 起 + claimed。默认打 demo owner(marcus,reseed-marcus claim 的);
# 别的实例用 OWNER_EMAIL=... 覆盖。自动 mint 临时 keypair 用完即销。注意:会往 corpus
# 写一条 eval 测试 raw+wiki,跑完用 reseed-marcus.sh 清回 50。
eval-owner-mcp:
	@OWNER_EMAIL="$${OWNER_EMAIL:-marcus@local.test}" eval-harness/owner-mcp-setup.sh

# dev-rebuild —— 改 backend / app 代码后强制 rebuild + recreate 指定服务，
# 不动 db/redis/minio (保数据)。用法：make dev-rebuild SVC=app
dev-rebuild: app-build
	@test -n "$(SVC)" || (echo "usage: make dev-rebuild SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml up -d --build --wait --force-recreate --no-deps $(SVC)

dev-down:
	@docker compose -f docker-compose.dev.yml down --remove-orphans

# meili-stop / meili-start —— 手动停/起 meilisearch,给 retrieval-degrade e2e 验降级 + 自愈用。
# (e2e workers:1 串行;degrade spec 在 afterAll 保证重启,不影响其他 spec)。
meili-stop:
	@docker compose -f docker-compose.dev.yml stop meilisearch

meili-start:
	@docker compose -f docker-compose.dev.yml up -d --wait meilisearch

# dev-logs —— tail 某个 service 的日志(诊断用)。用法：make dev-logs SVC=backend N=80
dev-logs:
	@test -n "$(SVC)" || (echo "usage: make dev-logs SVC=<service> [N=<lines>]"; exit 2)
	@docker compose -f docker-compose.dev.yml logs --tail=$(if $(N),$(N),60) $(SVC)

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
# REPEAT=N —— 把这个 spec 跑 N 遍（--repeat-each），抓间歇性 flake 用。
# usage:   make test-only SPEC=blog-posts
#          make test-only SPEC=blog-posts GREP="MCP post_create"
#          make test-only SPEC=visitor-ask-visitor REPEAT=15
test-only: dev-up
	@test -n "$(SPEC)" || (echo "usage: make test-only SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT))

# test-headed —— 跟 test-only 同,但 --headed 开真浏览器肉眼观测(单 worker,
# 一条一条跑)。reading-dom 那条带 [[slow-final:2500]],throbber 会停 2.5s 看得清。
test-headed: dev-up
	@test -n "$(SPEC)" || (echo "usage: make test-headed SPEC=<spec-name> [GREP=<title pattern>]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) --headed --workers=1 $(if $(GREP),-g "$(GREP)")

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
