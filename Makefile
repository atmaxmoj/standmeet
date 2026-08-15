# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build + test。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 子项目的具体 lint 链在各自的 Makefile / package.json 里定义。
# 没装依赖（node_modules 不存在）或没 src 的子项目自动 skip，便于早期
# 增量开发时 lefthook 不被未启用的子项目卡住。

.PHONY: lint backend-lint backend-test plugin-test backend-no-mock app-lint sdk-lint e2e-lint env-lint
.PHONY: dev dev-up dev-rebuild dev-down prod-up prod-down prod-logs build clean test test-fresh test-only test-red archive-failures sdk-build app-build sqlc-gen gateway-up eval-smoke eval-ghost eval-ask eval-compaction eval-doc-context eval-cross-conversation eval-interview eval-summary eval-capabilities eval-owner-mcp verify-round schema-drift i18n-keys

# ── lint ────────────────────────────────────────────────────────
# 顺序：env-lint 最快，先跑；backend 的 make lint 链已经很丰富；前端
# 各自跑 eslint + tsc + knip。backend-no-mock 是 G-Y 强制的"backend 不
# 准含 mock-only 代码"约束。
lint: env-lint backend-lint backend-no-mock app-lint sdk-lint e2e-lint verify-items

env-lint:
	@LINT_ENV_EXCLUDE="standmeet-client standmeet-server standmeet-e2e" \
	  infra/scripts/lint-env "$$(pwd)"
	@infra/scripts/check-knobs-reachable.sh
	@infra/scripts/check-knobs-reachable-test.sh

backend-lint:
	@$(MAKE) -C backend lint

# backend-test —— Go 单元/集成测试（testify，无 DB/docker）。e2e 走 `make test`。
# 一并跑 mcp-servers/ 下每个插件模块自己的测试：它们是独立 go module，`go test ./...`
# 在 backend/ 里够不着，于是 ask-visitor 的那个测试写完之后**从来没有人跑过**。
backend-test: plugin-test
	@$(MAKE) -C backend test

# plugin-test —— 每个 mcp-servers/<plugin> 是一个独立 module；各跑各的 go test。
plugin-test:
	@for d in mcp-servers/*/; do \
		[ -f "$$d/go.mod" ] || continue; \
		echo "[plugin-test] $$d"; \
		(cd "$$d" && go test ./...) || exit 1; \
	done

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
# check-core-agnostic-test.sh 同理自测 #135 内核零能力棘轮：种一个 calendar 泄漏，断言被抓。
# (棘轮本体 check-core-agnostic 已在 backend 的 fast lint 链里；这里只跑它的自测。)
backend-no-mock:
	@infra/scripts/check-no-mock
	@infra/scripts/check-no-mock-test.sh
	@infra/scripts/check-core-agnostic-test.sh

# 前端子项目：node_modules 没装就 skip（启用时再 pnpm install）。
app-lint:
	@infra/scripts/check-i18n-keys
	@infra/scripts/check-css-parses.sh
	@infra/scripts/check-one-scrim.sh
	@infra/scripts/check-one-layer-scale.sh
	@infra/scripts/check-one-select.sh
	@infra/scripts/check-one-text-input.sh
	@infra/scripts/check-one-time-format.sh
	@infra/scripts/check-no-computed-class.sh
	@infra/scripts/check-sm-class-defined.sh
	@infra/scripts/check-peek-signals-more.sh
	@infra/scripts/check-tool-paths-exist.sh
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
	# Rebuild ONLY the services whose code changes every loop (app + backend). The mocks
	# (mcp-server-mock / external-mock / llm-gateway / mail-mock) also have build: contexts but rarely
	# change — `up` (without --build) reuses their existing images and builds them only the first time
	# they're missing. This keeps the per-loop rebuild to app+backend instead of all 6 build contexts.
	# If a mock's own code changes, run `make dev-rebuild-mocks` once.
	@docker compose -f docker-compose.dev.yml build app backend
	@docker compose -f docker-compose.dev.yml up -d --wait
	@echo "[dev] app=http://localhost:3000 backend=http://localhost:8000"

# dev-rebuild-mocks —— force-rebuild the mock/support images (only needed when a mock's source
# changed; the normal dev-up path reuses their cached images).
dev-rebuild-mocks:
	@docker compose -f docker-compose.dev.yml build mcp-server-mock external-mock llm-gateway mail-mock

# prod-up —— bring up the real production stack (self-contained: app + backend +
# db + redis + gotenberg + minio, no mocks). Reads .env (cp from .env.example).
# = dev minus the mocks, with real secrets. TLS/domain is external (front the
# app's published port with your proxy). Separate compose project + offset host
# ports so it coexists with the dev/test stack.
#
# That proxy is not only about TLS. The app hop (Next rewrites /api/* to the
# backend) adds no X-Forwarded-For, so without a proxy that sets one, NO visitor
# address ever reaches the backend: conversations record no source IP, IP bans
# have nothing to target, and the per-IP code lockout becomes one shared bucket.
# The backend says so once in its log when it happens.
prod-up:
	@test -f .env || { echo "create .env first: cp .env.example .env && edit"; exit 2; }
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --build --wait
	@echo "[prod] app on http://localhost:38227 (front with your TLS proxy)"
	@echo "[prod] that proxy must set X-Forwarded-For — without it no visitor IP is"
	@echo "[prod] visible: no source IP on conversations, nothing for an IP ban to"
	@echo "[prod] target, and the per-IP code lockout applies to everyone at once."

# prod-app —— rebuild ONLY the prod app image (frontend-only change) from a fresh host
# `app-build`, reusing the running prod backend/db/etc. Use to ship an app-only fix when a full
# prod-up (which also rebuilds the backend) is unnecessary or blocked by an unrelated backend WIP.
prod-app: app-build
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build app
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --wait app
	@echo "[prod] app rebuilt (backend reused) — http://localhost:38227"

prod-down:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml down

# prod-stop-svc / prod-start-svc —— 停/起 prod 里的**一个** service。真实环境审计里反复要的
# 那件装置：好几条 check 问的是「这东西不在了，产品会怎么说」（F-N-2 的后端停机、admin-shell
# check 4 的 live 灯、corpus-acl check 6 的加载失败），而那只能真的把它停掉。
#
#   make prod-stop-svc SVC=backend   # 注入
#   make prod-start-svc SVC=backend  # 收工必须做，别把实例留在停机态
#
# **它不删数据**：stop 不是 down，卷和容器都还在，起回来就是原样。
prod-stop-svc:
	@test -n "$(SVC)" || (echo "usage: make prod-stop-svc SVC=<service>"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml stop $(SVC)

prod-start-svc:
	@test -n "$(SVC)" || (echo "usage: make prod-start-svc SVC=<service>"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml start $(SVC)

# verify-proxy-up —— 起故障注入代理，坐在**真** provider 前面（agent-loop-robustness 的 Real
# dep 点名要的那件装置）。它在 prod 那张网里，但**不在 prod compose 里**：生产文件不该带一个能
# 让 LLM 调用限流的服务。
#
#   make verify-proxy-up UPSTREAM=https://api.deepseek.com
#
# 起来之后在 admin 的 AI provider 表单把 endpoint 改成 http://llm-fault-proxy:9500 —— 走产品
# 自己的界面接线，不改环境变量。**驱完记得改回去**，否则代理一停，这个实例就没有模型可用了。
verify-proxy-up:
	@test -n "$(UPSTREAM)" || { echo "usage: make verify-proxy-up UPSTREAM=https://api.provider.com"; exit 2; }
	@UPSTREAM_BASE_URL=$(UPSTREAM) docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --build
	@echo "[verify] proxy on http://localhost:39500 → $(UPSTREAM)"
	@echo "[verify] backend reaches it at http://llm-fault-proxy:9500"

verify-proxy-down:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml down

# prod-clean —— down + drop the prod volumes (pgdata/redis/minio). schema.sql
# only applies on a FRESH pg volume, so a stale prod volume must be recreated
# after a schema change (greenfield "no migrations" posture — see schema.sql).
#
# ⚠️ THIS DESTROYS THE VERIFICATION INSTANCE. The prod stack is where the real-env audit runs:
# the owner account, the 1009-entry corpus synced from the real vault, the issued access codes,
# the connected SMTP credentials and the job pool all live in these volumes. Wiping them costs
# a full re-claim + re-sync + re-configure, and any live audit round loses its ground truth.
#
# It needs `I_MEAN_IT=yes` because on 2026-08-10 I reached for `prod-fresh` when I wanted
# `prod-up` — the names sit three lines apart, one rebuilds and one destroys, and nothing
# between typing it and losing the instance asked a single question. A comment saying "careful"
# would not have helped: I had already read this file today. The confirmation is the fix
# ([[reframes-tasks-into-enforced-invariants]] — make the mistake impossible, not documented).
prod-clean:
	@test "$(I_MEAN_IT)" = "yes" || ( \
	  echo "prod-clean DESTROYS the prod volumes — the audit instance (owner, corpus, codes, creds)."; \
	  echo "  rebuild the app only ....... make prod-app"; \
	  echo "  rebuild backend + app ...... make prod-up"; \
	  echo "  really wipe it ............. make prod-clean I_MEAN_IT=yes"; \
	  exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml down -v --remove-orphans 2>/dev/null || true

# prod-fresh —— recreate the prod stack from scratch (fresh schema).
# Inherits prod-clean's confirmation: `make prod-fresh I_MEAN_IT=yes`.
prod-fresh: prod-clean prod-up

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

# eval-narration —— F-A-4 eval: a BROAD visitor question against the REAL model (DeepSeek),
# with the REAL corpus tools wired (retrieval plugin over a host socket), fresh fictional
# persona (Dana Rivera). Asserts the model actually GROUNDS the answer (calls the tools) and
# synthesizes — not planning narration, not an ungrounded riff. Real LLM, no mock; skips
# without a key.
#
# The key comes from ~/.config/standmeet/verify-creds.env — the same one home every other real
# credential lives in (verify-shots sources it the same way). It is NOT copied into a repo .env:
# a second copy of a secret is a second place to leak it from, and the harness already reads
# whatever the environment gives it (eval-harness/env.go falls back to a .env only if unset).
eval-narration: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestNarrationLive -count=1 -v ./...

# EVAL_ENV / eval-creds —— load the real provider key into the recipe's environment.
# One home for credentials; the recipe fails loudly if that home is missing, rather than
# skipping the test and reporting a green that never ran the model.
EVAL_ENV = set -a; . $$HOME/.config/standmeet/verify-creds.env; set +a;
eval-creds:
	@test -f $$HOME/.config/standmeet/verify-creds.env || \
	  (echo "missing ~/.config/standmeet/verify-creds.env — the real-env credentials live there"; \
	   exit 2)

# eval-booking-fabrication —— F-A-37 eval: on prod the agent told a visitor a meeting was booked
# while making ZERO tool calls (empty calendar, no card). A mock spec cannot catch that: every
# booking spec FORCES the call through scriptMockToolCall, so the thing that failed — the model's
# own decision to call the tool — is not on trial there. This drives the REAL model through the
# REAL prod loop with the REAL booker plugin (canned calendar behind it) and asserts one thing:
# if the answer says a meeting is booked, the capability store must hold that booking.
# Probabilistic, so drive rounds: EVAL_ROUNDS=20 make eval-booking-fabrication.
eval-booking-fabrication: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestBookingFabricationLive -count=1 -v -timeout 1800s ./...

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

# verify-round —— 开一轮真实环境手工验证。建一个按开始时间命名的目录:
# e2e/manual-runs/<UTC 时间戳>/{runsheet.md, trajectory/<模块>.md, shots/}。
# runsheet 从 docs/real-env-verification/items/ 生成(不手抄,加了模块下一轮自动出现);
# 整个目录 gitignore —— 它是一次跑动的证据,不是关于产品的文档。SOP 在
# docs/real-env-verification/sop.md §0。
#   make verify-round
verify-round:
	@infra/scripts/verify-round

# verify-shots —— 手工验证第 ⑤ 步的**拍照驱动器**：开一个真浏览器，按 plan 登录 / 点 /
# 输入 / 截图，图落进那一轮的 trajectory 目录。判断看图，不看 DOM 文本。
#
# 为什么有它：⑤ 一直靠浏览器 MCP 驱动，而 MCP 会掉线（掉线那次手上只剩一个跑在**另一台
# 机器**上的 Chrome，打不到本机 38227）。驱动器可以换，环境不能换 —— 它打的是 **prod**，
# 真 vault、真语料、真 provider。
#
# **它不碰数据**：只登录、导航、截图，一行都不写。别把它跟 e2e 混起来 —— e2e 打 dev 并且
# 每个 spec 都重置实例，那个动作在 prod 上会把真语料清掉。
#
#   make verify-shots PLAN=e2e/manual/plans/seo.json
verify-shots:
	@test -n "$(PLAN)" || (echo 'usage: make verify-shots PLAN=e2e/manual/plans/<name>.json'; exit 2)
	@set -a; . $$HOME/.config/standmeet/verify-creds.env; set +a; \
	  cd e2e && node manual/shoot.mjs "../$(PLAN)"

# verify-mcp —— 用 owner 的 MCP 那条路驱 prod。**它是 verify-shots 的兄弟**：那条走界面，
# 这条走 owner 在 Claude 里的那条路 —— 好几条 check 的 Expected 说的是「读工具的回执」，
# 而面板根本产不出那个东西（page.unpin 动了哪些区、custom_page 的生命周期、jobs.fetch_new
# 抓回多少条）。
#
# **不手搓 Sigv1 签名器**：起的是**产品自己**的 stdio 客户端（`sdk/packages/mcp-client/bin`），
# 跟 owner 在 Claude Desktop 里配的是同一个二进制、同一套环境变量。绕过它去自己签名，
# 验的就不是产品那条路了（[[c3-stdio-sdk-sigv1-401]]）。
#
# 凭据：GUI 上铸一对 keypair → 下载 .pem → `downloads/build-creds.sh <pem> <key-id>` 拼出
# credentials.json。**收工必须在 GUI 上吊销 keypair 并删掉本地私钥。**
#
#   make verify-mcp CREDS=e2e/manual-runs/<round>/downloads/credentials.json \
#     CALLS='[{"name":"page.pin","args":{"section":"insights","entry_id":"…"}}]'
verify-mcp:
	@test -n "$(CREDS)" || (echo 'usage: make verify-mcp CREDS=<credentials.json> CALLS=<json array>'; exit 2)
	@test -n "$(CALLS)" || (echo 'usage: make verify-mcp CREDS=<credentials.json> CALLS=<json array>'; exit 2)
	@node e2e/manual/mcp-drive.mjs sdk/packages/mcp-client/bin/standmeet-mcp \
	  "$${STANDMEET_VERIFY_HOST:-http://localhost:38227}" "$(CREDS)" '$(CALLS)'

# schema-drift —— 问运行中的库:schema.sql 里声明的表/列,你到底有没有。schema.sql 只在
# **全新卷**上被 postgres 应用一次,所以长命实例停在它出生时的样子,后加的列只活在文件里 ——
# backend 照常起来,直到某个界面上的某条查询才炸。开审计轮之前先跑它。
#   make schema-drift            # prod
#   STACK=dev make schema-drift  # dev
schema-drift:
	@infra/scripts/schema-drift

# i18n-keys —— 每个 t('key') 必须能在它的 namespace 里解析。缺一条 message 不是构建错误:
# 它会把 key 路径直接渲染给 owner 看(F-L-15:/admin/subjectivity 17 行全是
# ADMINCORPUS.COMMON.EDIT)。仓库原有的 i18n lint 问的是反方向(有没有硬编码字符串),
# 而点这个按钮的 e2e 也会过——按钮在、能点,只有文字是条 key。
#   make i18n-keys
i18n-keys:
	@infra/scripts/check-i18n-keys

# verify-items —— 审计的 item 是**测试描述**,不许记状态。跑的状态在那一轮的 runsheet,
# 缺陷的状态在 findings.md。两个账本一定会互相漂移,而且"没做"和"做了"一样不可信。
# 闸门本身带自测(planted 违例必须被抓到),因为一个瞎了的扫描器会报"全清"。
verify-items:
	@infra/scripts/check-verify-items --self-test >/dev/null
	@infra/scripts/check-verify-items

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

# dev-stop-svc —— 停掉栈里的**一个** service(故障注入用)。用法：make dev-stop-svc SVC=mailpit
# 例：验证 e2e 的 ensureStackUp 在某个容器倒下时真的会把它拉回来 —— 一个只会说"好"的检查等于没有。
# 停完用 make dev-up(或任意一条 spec 的 resetInstance)拉回来。
dev-stop-svc:
	@test -n "$(SVC)" || (echo "usage: make dev-stop-svc SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev stop $(SVC)

# dev-restart-svc —— 重启栈里的**一个** service。用法：make dev-restart-svc SVC=backend
# 例：只在起进程时跑一次的那类任务(周期任务的第一跑就在 boot),测它得让进程重来一次。
# dev-pgsearch-on / -off —— 让 dev **模拟一次检索降级**（拿掉 Meili，退 Postgres 全文）再恢复。
#
# 存在的理由：corpus-search 的 check 4 要驱「搜索引擎没了会怎样」，而在此之前没有装置能进到
# 降级路径上 —— 于是所有搜索 e2e 都只测过 Meili 那一半。
#
# **别把它读成"切到 prod 那条路"。** 设计里 `corpus_search` 就是走 Meili 的工具；prod compose
# 里没有 meilisearch 是事故（F-S-3），不是意图。
#
# **切过去之后，"绿"的含义变了。** 用它跑出来的结论要注明跑在哪条路上，否则下一个人会把两组
# 不同的断言当成同一件事。
dev-pgsearch-on:
	@docker compose -f docker-compose.dev.yml -f docker-compose.pgsearch.yml \
		-p standmeet-dev up -d --wait --force-recreate backend
	@echo "[dev] search path = Postgres full text (prod's default). MEILI_URL blanked."

dev-pgsearch-off:
	@docker compose -f docker-compose.dev.yml -p standmeet-dev \
		up -d --wait --force-recreate backend
	@echo "[dev] search path = meilisearch (dev default)."

dev-restart-svc:
	@test -n "$(SVC)" || (echo "usage: make dev-restart-svc SVC=<service>"; exit 2)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev restart $(SVC)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev up -d --wait $(SVC)

# dev-logs —— tail 某个 service 的日志(诊断用)。用法：make dev-logs SVC=backend N=80
dev-logs:
	@test -n "$(SVC)" || (echo "usage: make dev-logs SVC=<service> [N=<lines>]"; exit 2)
	@docker compose -f docker-compose.dev.yml logs --tail=$(if $(N),$(N),60) $(SVC)

# prod-logs —— 同上,但对着真实环境那一套(真实环境审计手工驱到不对时,第一步就是读它的日志)。
# 用法：make prod-logs SVC=backend N=80
prod-logs:
	@test -n "$(SVC)" || (echo "usage: make prod-logs SVC=<service> [N=<lines>]"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml logs \
		--tail=$(if $(N),$(N),60) $(SVC)

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
# test —— 全量。**跑完自动把失败现场归档**（见 archive-failures）：playwright 的
# test-results/ 会被下一次 `make test-only` 整个覆盖，而修 bug 时第一件事就是跑单条 ——
# 于是全量的现场在你需要它的前一秒被自己抹掉，只能靠重抓，而重抓是 SOP 明令的下策。
# 归档是自动的：靠"记得先备份"就等于没有。
test: dev-up
	@cd e2e && pnpm exec playwright test; st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# archive-failures —— 把这一轮的失败现场复制到 e2e/test-results-archive/<UTC 时间戳>/。
# 没有失败就什么都不做。归档目录带时间戳，所以历次全量互不覆盖。
archive-failures:
	@test -d e2e/test-results/playwright || exit 0
	@ls e2e/test-results/playwright 2>/dev/null | grep -q . || exit 0
	@d="e2e/test-results-archive/$$(date -u +%Y%m%dT%H%M%SZ)"; \
		mkdir -p "$$d" && cp -R e2e/test-results/playwright "$$d"/ && \
		docker logs standmeet-dev-backend-1 > "$$d/backend.log" 2>&1 || true; \
		echo "[archive] failure artifacts → $$d/playwright ($$(ls e2e/test-results/playwright | wc -l | tr -d ' ') case dirs) + backend.log"

# test-fresh —— 跟 test 一样，但先 clean (down -v) 让 db volume 重建从 schema.sql
# 重新 apply。schema 改过 (db/schema.sql) 必须用这个；纯代码改用 `make test`。
test-fresh: clean test

# test-only —— 只跑一个 spec / 一个 grep 模式。隔离 reproducer 用。
# REPEAT=N —— 把这个 spec 跑 N 遍（--repeat-each），抓间歇性 flake 用。
# usage:   make test-only SPEC=blog-posts
#          make test-only SPEC=blog-posts GREP="MCP post_create"
#          make test-only SPEC=visitor-ask-visitor REPEAT=15
# 归档也挂在 test-only 上:playwright 的 test-results/ 会被**下一次**运行清空,而下一次运行
# 通常就是去修第一个失败时敲的那条 test-only —— 其余失败的现场会在你需要它的前一秒自己删掉。
# 只有 `make test` 归档是不够的:批次验证同样会产出必须留证的失败。
test-only: dev-up
	@test -n "$(SPEC)" || (echo "usage: make test-only SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT)); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# test-captcha —— bring the dev stack up WITH captcha on, using Cloudflare's published test keys,
# and run the captcha specs against it.
#
# Every other spec runs with captcha off (the vars are empty by default), which is the shipped
# default and what the rest of the suite should exercise. But "off everywhere" is why the visitor
# captcha surfaces were never driven at all: the widget only renders when the instance publishes a
# site key (F-G-3).
#
# The keys below are Cloudflare's own always-pass pair, published for exactly this. The widget
# self-issues a token — there is no challenge being defeated, which is the whole point of a vendor
# test mode. Real challenges stay off limits.
#
#   1x00000000000000000000AA          sitekey, always passes
#   1x0000000000000000000000000000000AA  secret, always validates
#
# Only the `captcha-on-*` specs run here, and the prefix is load-bearing: with the always-pass
# secret the provider validates ANY token, so `security-captcha-bypass` — which asserts a forged
# token is refused — fails on this stack for a reason that is not a defect. That spec belongs to
# the captcha-OFF default suite. A greedy `captcha` glob pulled it in once and produced exactly
# that false red.
#
# The stack is left running with captcha ON — `make dev-up` puts it back.
test-captcha:
	@TURNSTILE_SITE_KEY=1x00000000000000000000AA \
	 TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
	 $(MAKE) dev-up
	@cd e2e && pnpm exec playwright test $(if $(SPEC),$(SPEC),captcha-on-); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# test-red —— run one spec against the images that are ALREADY RUNNING. No dev-up, no rebuild.
#
# This exists for one step of the fix SOP: proving a new test actually fails on the buggy code.
# `test-only` depends on dev-up, so by the time it runs, the fix sitting in the working tree has
# been built into the images — a test written and run after the fix can only ever be seen green,
# and a test that cannot go red says nothing. Run this BEFORE rebuilding to watch it fail, then
# `make test-only` to watch the same test pass.
#
# The stack must already be up (this target deliberately does not bring it up: bringing it up is
# what would rebuild it). usage: make test-red SPEC=test/foo.spec.ts [GREP=...] [REPEAT=N]
test-red:
	@test -n "$(SPEC)" || (echo "usage: make test-red SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@docker compose -f docker-compose.dev.yml -p standmeet-dev ps --status running --quiet backend \
		| grep -q . || (echo "test-red: dev stack is not running — start it with 'make dev-up' (that rebuilds)"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT)); \
		st=$$?; cd .. && $(MAKE) archive-failures; exit $$st

# dev-app —— rebuild ONLY the dev app image (frontend-only change) and reuse the running
# backend/mocks. Use when a fix is app-only and a full dev-up (which also rebuilds backend) is
# unnecessary or blocked (e.g. an unrelated uncommitted backend WIP failing `make lint`). The
# rest of the stack must already be up.
dev-app: app-build
	@docker compose -f docker-compose.dev.yml build app
	@docker compose -f docker-compose.dev.yml up -d --wait app
	@echo "[dev] app rebuilt (backend + mocks reused)"

# test-run —— run a spec WITHOUT the dev-up rebuild (assumes the stack is already up). Pair with
# dev-app for an app-only change, or when dev-up's backend rebuild is unnecessary/blocked.
test-run:
	@test -n "$(SPEC)" || (echo "usage: make test-run SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@cd e2e && pnpm exec playwright test $(SPEC) $(if $(GREP),-g "$(GREP)") $(if $(REPEAT),--repeat-each=$(REPEAT))

# test-unit —— fast headless unit tests for reusable render/toolbox primitives (vitest, no Docker,
# no browser). Scoped to pure framework-shaped units — e.g. the markdown→HTML render pipeline where
# the bug lives in the pipeline, not a full-stack flow (F-R-3: sanitize must run before katex). The
# e2e suite stays the primary coverage; this is the guard for things e2e structurally can't pin.
test-unit:
	@cd app && pnpm run test:unit

# gui-p1-variant —— F-A-4 P1 presentation-variant probe: drive the REAL prod GUI (real
# DeepSeek) through one broad-question visitor turn, screenshot narration/tools/done/reload
# moments into /tmp/p1-variants/<VARIANT>-*.png + a JSON summary. Prod stack must be up.
# usage: make gui-p1-variant VARIANT=iii-status-quo [CODE=FA5-001]
gui-p1-variant:
	@test -n "$(VARIANT)" || (echo "usage: make gui-p1-variant VARIANT=<name> [CODE=...]"; exit 2)
	@cd e2e && VARIANT=$(VARIANT) $(if $(CODE),CODE=$(CODE)) pnpm exec node scripts/p1-variant-drive.mjs

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

# prod-psql —— run SQL against the prod DB.  usage: make prod-psql SQL="select 1"
#
# schema.sql is applied by postgres ONLY on a fresh volume (see docker-compose.prod.yml), so an
# instance that predates a new table never gets it — the backend just 500s on that route forever.
# This is the escape hatch for the verification stack; it is NOT an upgrade story for real
# self-hosted owners (see F-A-16).
prod-psql:
	@test -n "$(SQL)" || (echo 'usage: make prod-psql SQL="select 1"'; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 -c "$(SQL)"

# prod-gate-unlock —— clear the gate's per-IP lockouts on prod.
#
# Driving a lockout by hand (F-G-3's ⑤, F-G-4's ⑤) really locks the gate for fifteen minutes, and
# on a stack with no proxy setting X-Forwarded-For the bucket is `unknown-source` — ONE bucket that
# every visitor shares (F-F-5). So a verification run would lock the door for everyone until the
# TTL runs out. This puts it back immediately.
#
# BOTH doors, because the gate has two per-IP tallies and they lock independently: `codefail:ip:`
# counts invalid codes, `requestflood:ip:` counts notes. Clearing only the first left the note door
# shut with nothing on screen to say so — the escape hatch has to know about every bucket the
# mechanism grew (`middleware/ip_tally.go` is the one place they are configured).
#
# It is a verification-stack escape hatch, not an owner feature: an owner who wants to lift a lock
# solves the captcha, which is the whole point of the surface this exists to test.
GATE_LOCK_PATTERNS = 'codefail:ip:*' 'requestflood:ip:*'
prod-gate-unlock:
	@for p in $(GATE_LOCK_PATTERNS); do \
		docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis \
			redis-cli --scan --pattern "$$p" | xargs -r docker compose -p standmeet-prod \
			-f docker-compose.prod.yml exec -T redis redis-cli DEL; \
	done
	@echo "[prod] gate lockouts cleared (invalid codes + note flood)"

# prod-psql-file —— same, for multi-line SQL.  usage: make prod-psql-file FILE=/tmp/x.sql
prod-psql-file:
	@test -f "$(FILE)" || (echo 'usage: make prod-psql-file FILE=<path.sql>'; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 < "$(FILE)"

# dev-psql —— run SQL against the DEV DB.  usage: make dev-psql SQL="select 1"
# For validating hand-written queries (stats_activity / stats_growth bypass sqlc) against real schema.
dev-psql:
	@test -n "$(SQL)" || (echo 'usage: make dev-psql SQL="select 1"'; exit 2)
	@docker compose -p standmeet-dev -f docker-compose.dev.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 -c "$(SQL)"

# docker-gc —— reclaim buildkit cache + dangling images. Safe: never touches running containers,
# named volumes (pgdata/redis/minio), or tagged images in use. Run when the Docker VM disk fills from
# many rebuilds (symptom: `docker system df` hangs, builds crawl).
#
# NOTE: prunes only cache OLDER than 24h — keeps the ACTIVE go-build/golangci/node cache warm so the
# next build stays fast. Do NOT `-a` here: `builder prune -a` frees max disk but forces a full cold
# rebuild (a ~15min go-mod-download + recompile tax). Use `make docker-gc-hard` only when truly full.
docker-gc:
	@echo "[docker-gc] pruning build cache older than 24h + dangling images"
	@docker builder prune -f --filter until=24h
	@docker image prune -f

# docker-gc-hard —— nuke ALL build cache (next build is a cold rebuild, slow). Last resort when the
# VM disk is near its cap and docker-gc didn't free enough.
docker-gc-hard:
	@docker builder prune -af
	@docker image prune -f
