# Root Makefile —— 聚合 backend / app / sdk / e2e 各自的 lint + build + test。
# 单一入口 `make lint` 跑全套；lefthook pre-commit 调它。CI 也调它。
#
# 子项目的具体 lint 链在各自的 Makefile / package.json 里定义。
# 没装依赖（node_modules 不存在）或没 src 的子项目自动 skip，便于早期
# 增量开发时 lefthook 不被未启用的子项目卡住。

.PHONY: lint secrets secrets-image release-build release-assert-stripped release-assert-multiarch release-push release-repro release-repro-logs release-repro-down backend-lint backend-test plugin-test backend-no-mock app-lint sdk-lint e2e-lint env-lint im-bridge-test im-bridge-up im-bridge-logs
.PHONY: dev dev-up dev-rebuild dev-down prod-up prod-down prod-logs build clean test test-fresh test-only test-red test-captcha test-boundary mobile-shots mobile-shots-asis archive-failures sdk-build builder-vendor dev-rebuild-builder app-build sqlc-gen gateway-up eval-smoke eval-ghost eval-ask eval-compaction eval-doc-context eval-cross-conversation eval-interview eval-summary eval-capabilities eval-owner-mcp verify-round schema-drift i18n-keys

# ── lint ────────────────────────────────────────────────────────
# 顺序：env-lint 最快，先跑；backend 的 make lint 链已经很丰富；前端
# 各自跑 eslint + tsc + knip。backend-no-mock 是 G-Y 强制的"backend 不
# 准含 mock-only 代码"约束。
lint: secrets env-lint backend-lint backend-no-mock app-lint sdk-lint e2e-lint im-bridge-test verify-items

# secrets —— 密钥扫描，排在最前面：它 5 秒，而它挡的那件事没有撤销键。
#
# 以前这一步在 `backend/lint` 链里，而它**从来没有扫过任何东西**：那个目标只在 `backend/`
# 里跑，仓库的 `.git` 在上一层，`[ -d .git ]` 恒假 → 每次打一行 skipping 退 0（F-H-6）。
secrets:
	@infra/scripts/check-secrets.sh

# lint-cached —— 跑 lint，但同一棵树只跑一次（见脚本头部：这是 2026-08-18 效率复盘的产物）。
# `pre-commit` 走这条；人手动跑 `make lint` 时也该走它。逃生门 FORCE_LINT=1。
lint-cached:
	@infra/scripts/lint-if-dirty.sh

env-lint:
	@LINT_ENV_EXCLUDE="standmeet-client standmeet-server standmeet-e2e" \
	  infra/scripts/lint-env "$$(pwd)"
	@infra/scripts/check-knobs-reachable.sh
	@infra/scripts/check-knobs-reachable-test.sh
	@infra/scripts/check-redis-bounded.sh
	@infra/scripts/check-doc-make-targets.sh

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
	@infra/scripts/check-one-empty-state.sh
	@infra/scripts/check-no-native-file-input.sh
	@infra/scripts/check-one-layer-scale.sh
	@infra/scripts/check-one-section-heading.sh
	@infra/scripts/check-one-select.sh
	@infra/scripts/check-one-text-input.sh
	@infra/scripts/check-one-time-format.sh
	@infra/scripts/check-no-computed-class.sh
	@infra/scripts/check-sm-class-defined.sh
	@infra/scripts/check-peek-signals-more.sh
	@infra/scripts/check-tool-paths-exist.sh
	@infra/scripts/check-instructions-name-sure-tools.sh
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

# im-bridge-test —— IM 桥的单测。**它不进 e2e**：桥是一个外部访客客户端，
# 它的逻辑（认码 / 开会话 / 配额 / 撤销 / 挡回声）对着替身就能证完，不需要起整套栈。
# 真平台那一趟归 docs/real-env-verification/items/im-bridge.md。
im-bridge-test:
	@if [ -d im-bridge/node_modules ]; then \
	  pnpm -F @standmeet/im-bridge lint && pnpm -F @standmeet/im-bridge test; \
	else \
	  echo "[skip] im-bridge/ has no node_modules — skipping"; \
	fi

# im-bridge-up —— 起 IM 桥。**不需要任何环境变量**：bot token 是 owner 在 admin 里
# 配的连接器凭据，桥启动后自己去内部接口取。没配就空转等着。
im-bridge-up:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --build im-bridge

im-bridge-logs:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml logs -f --tail=100 im-bridge

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
# builder-vendor —— 把 SDK 产物摆进自定义页 builder 的构建上下文。
#
# **为什么必须有这一步**：builder 镜像里 owner 的页面只能 import 到
# /opt/builder/node_modules 里有的东西，而那里只有 react/vite —— 所以托管出来的页面
# 除了渲染文字什么都做不了（没有 corpus、没有 agent）。SDK 是 workspace 包不是发布包，
# 而 builder 的构建上下文是 ./builder，镜像 COPY 不到 sdk/，只能先摆过去。
#
# ⚠️ 跟 `prod-app: app-build` 同一族：**产物在哪就先产在哪**，而这一族的失效方式是
# 拷到一份**旧的**还照印成功。脚本因此不静默拷贝：缺了就建，建完报出摆了什么。
builder-vendor:
	@infra/scripts/builder-vendor.sh

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

dev-up: app-build builder-vendor
	@infra/plugins/provision.sh
	# Rebuild ONLY the services whose code changes every loop (app + backend). The mocks
	# (mcp-server-mock / external-mock / llm-gateway / mail-mock) also have build: contexts but rarely
	# change — `up` (without --build) reuses their existing images and builds them only the first time
	# they're missing. This keeps the per-loop rebuild to app+backend instead of all 6 build contexts.
	# If a mock's own code changes, run `make dev-rebuild-mocks` once.
	@docker compose -f docker-compose.dev.yml build app backend
	@docker compose -f docker-compose.dev.yml up -d --wait
	@echo "[dev] app=http://localhost:3000 backend=http://localhost:8000"

# dev-rebuild-builder —— 重建自定义页 builder 镜像并换上容器。
#
# 改了 `builder/`（runner / template / Dockerfile）**或改了 SDK** 之后要跑：页面能 import
# 到什么，取决于镜像里 /opt/builder/node_modules 有什么，而那是镜像构建期定死的。
# 先 builder-vendor 摆产物再 build —— 跟 dev-rebuild-mocks 同一条教训：只 build 不换容器，
# 跑的还是旧进程，而红看起来跟产品的红一模一样。
dev-rebuild-builder: builder-vendor
	@docker compose -p standmeet-dev -f docker-compose.dev.yml build builder
	@docker compose -p standmeet-dev -f docker-compose.dev.yml up -d --no-deps builder

# dev-rebuild-mocks —— force-rebuild the mock/support images (only needed when a mock's source
# changed; the normal dev-up path reuses their cached images).
dev-rebuild-mocks:
	@docker compose -f docker-compose.dev.yml build mcp-server-mock external-mock llm-gateway mail-mock
	@# build 只造镜像,**不换正在跑的容器** —— 少了这一步,改完 mock-stack/ 再跑用例,
	@# 跑的还是旧那个进程,而红看起来跟产品的红一模一样(2026-08-17 在 F-C-33 上吃了一次:
	@# external-mock 已经起了 19 小时,我却以为新行为上线了)。
	@docker compose -f docker-compose.dev.yml up -d --wait \
		mcp-server-mock external-mock llm-gateway mail-mock

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
prod-up: builder-vendor
	@test -f .env || { echo "create .env first: cp .env.example .env && edit"; exit 2; }
	@infra/plugins/provision.sh
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --build --wait
	@echo "[prod] app on http://localhost:38227 (front with your TLS proxy)"
	@echo "[prod] that proxy must set X-Forwarded-For — without it no visitor IP is"
	@echo "[prod] visible: no source IP on conversations, nothing for an IP ban to"
	@echo "[prod] target, and the per-IP code lockout applies to everyone at once."

# prod-app —— rebuild ONLY the prod app image (frontend-only change) from a fresh host
# `app-build`, reusing the running prod backend/db/etc. Use to ship an app-only fix when a full
# prod-up (which also rebuilds the backend) is unnecessary or blocked by an unrelated backend WIP.
prod-app: app-build
	@infra/scripts/build-cadence.sh prod-app
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build app
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --wait app
	@echo "[prod] app rebuilt (backend reused) — http://localhost:38227"

# prod-backend —— 重建 backend 镜像并换上（app 不动）。`prod-app` 的对称物。
#
# 为什么单独一条：`prod-app` 只建 app 镜像，`prod-recreate-svc` 只换容器**不建镜像** ——
# 改了 Go 代码之后用那两条里的任何一条，跑的都还是旧二进制。今天在 F-C-41 的 ⑤ 上
# 就这么白验了一次：屏幕上一切照旧，我差点以为修的那一刀没生效。
# ⚠️ provision.sh 必须在这里跑。prod 把 `./infra/plugins` 挂到 `/srv/plugins` 上（compose:138），
# **盖住了镜像里刚编出来的那份**。所以改 `mcp-servers/*` 之后只 build 镜像，跑的仍是主机上那份
# 旧二进制 —— 而这条命令照样印「backend rebuilt」。2026-08-18 在 booker 的取消按钮上撞到：
# 镜像建了三次，屏幕上一点没变，binary 里 grep 不到新加的 class。
# 同一族：`prod-app` 要先 `app-build`（镜像 COPY 的是主机产物）。**产物在哪，就先产在哪。**
prod-backend:
	@infra/scripts/build-cadence.sh prod-backend
	@infra/plugins/provision.sh
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build backend
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --wait backend
	@echo "[prod] backend rebuilt (app reused) — http://localhost:38227"

# prod-rebuild-builder —— `dev-rebuild-builder` 的对称物。改了 builder/ 或 SDK 之后，
# prod 上的页面能 import 到什么同样是镜像构建期定死的。
prod-rebuild-builder: builder-vendor
	@docker compose -p standmeet-prod -f docker-compose.prod.yml build builder
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --no-deps builder

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

# prod-recreate-svc —— 重建一个服务的容器，**不重构建镜像**。
#
# 为什么 `prod-start-svc` 不够：`stop` + `start` 重启的是**同一个容器**，它的环境变量是创建时
# 定死的 —— 改了 `.env` 再 start，进程读到的还是旧值。connector-security check 3
# （轮换 INSTANCE_SECRET 之后连接器该说什么）要的正是「换个密钥重新起来」，
# 而 `prod-up` 会把整栈连镜像一起重建。
#
#   make prod-recreate-svc SVC=backend
prod-recreate-svc:
	@test -n "$(SVC)" || (echo "usage: make prod-recreate-svc SVC=<service>"; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml \
		up -d --no-deps --force-recreate --wait $(SVC)

# verify-proxy-up —— 起故障注入代理，坐在**真** provider 前面（agent-loop-robustness 的 Real
# dep 点名要的那件装置）。它在 prod 那张网里，但**不在 prod compose 里**：生产文件不该带一个能
# 让调用失败的服务。
#
#   make verify-proxy-up UPSTREAM=https://api.deepseek.com
#
# 起来之后在 admin 的 AI provider 表单把 endpoint 改成 http://llm-fault:9500 —— 走产品
# 自己的界面接线，不改环境变量。**驱完记得改回去**，否则代理一停，这个实例就没有模型可用了。
#
# ⚠️ **还差一步，照上面做会失败**（2026-08-19 撞到）：SSRF 判据带白名单
# （`httpx/ssrf.go` 的 `EGRESS_ALLOW_HOSTS`），而 **prod 那份是空的 —— 设计如此**
# （"EMPTY in prod (block everything internal)"）。所以指过去之后收到的是
# *"That endpoint resolves to an internal/private address and is not allowed."*，
# 而它长得像产品拒绝了你、不像少配了一项。
# 要用这条路，得让那台实例的 `EGRESS_ALLOW_HOSTS` 含 `llm-fault`（dev 那份已经含
# `llm-gateway,external-mock`，所以 dev 上直接能用）。
# **不要把它写死进 prod compose** —— prod 的默认就该是「什么内网都不许出」。
verify-proxy-up:
	@test -n "$(UPSTREAM)" || { echo "usage: make verify-proxy-up UPSTREAM=https://api.provider.com"; exit 2; }
	@UPSTREAM_BASE_URL=$(UPSTREAM) docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --build llm-fault
	@echo "[verify] proxy on http://localhost:39500 → $(UPSTREAM)"
	@echo "[verify] backend reaches it at http://llm-fault:9500"

verify-proxy-down:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml down

# verify-caldav-up —— 起一台**真的** CalDAV server（Radicale）给 connector-assembly check 5。
#
# 为什么不用我们的替身：那条 check 的 Mock gap 把缺的四样点了名 —— 替身没有鉴权、不认
# REPORT filter、不展开重复规则、每个 property 请求都答一样。**这条 check 要验的每一样它都没有。**
# item 的 Real dep 写的就是「a self-run CalDAV server with auth」，所以这不是绕过真实性，
# 这就是它要的器材。
#
#   make verify-caldav-up     # 宿主 http://localhost:35232 · backend 用 http://radicale:5232
#   make verify-caldav-down   # 驱完收摊
#
# 账号：verify / verify-caldav-pw（一台一次性的测试台 server，密码写在 compose 注释里）。
verify-caldav-up:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --wait radicale
	@echo "[verify] radicale on http://localhost:35232 (backend: http://radicale:5232)"
	@echo "[verify] user verify / verify-caldav-pw"

verify-caldav-down:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml rm -sf radicale

# verify-api-fault-up —— 同一个代理，上游换成本实例的 backend，然后把 prod app 的 BACKEND_URL
# 指过来。给的是**窄故障**：让某一个 admin 接口自己失败，看那一块说什么
# （corpus-acl-editing check 6 —— 加载失败不许穿空状态的衣服）。
#
# 为什么不是「停掉 backend」：那是整栈停机，验的是另一条路（已驱过，撞出 F-N-2）。窄故障要的是
# **同一页上别的块照常加载**，只有一块坏了 —— 空状态和加载失败长得一样，正是在这种情况下才分得出。
#
#   make verify-api-fault-up
#   curl -XPOST localhost:39600/__mock/fault/arm \
#     -d '{"mode":"http_error","path_prefix":"/api/admin/roles"}'
#   …驱…
#   curl -XPOST localhost:39600/__mock/fault/reset
#   make verify-api-fault-down
#
# ⚠️ **为什么这里要重建 app 而不是只改环境变量**：`/api/*` 走的是 next.config.ts 的 rewrite，
# 而 rewrite 的目标地址被**烤进构建产物**（`.next/required-server-files.json` 里逐字写着
# `http://backend:8000`）。第一版这条配方只在 compose 里改 `BACKEND_URL`，容器里的变量确实变了，
# 代理却一条流量都没收到 —— 因为那半边根本不在运行时读。同一个变量另外四个使用点
# （`api/v1/agent/turn`、`print-payload`、`lib/api/public`、`lib/api/instance`）**是**运行时读的，
# 所以它半边动半边不动。这件事本身是一条缺陷（F-C-40），这里先按真相把配方写对。
verify-api-fault-up:
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml up -d --build api-fault
	@BACKEND_URL=http://api-fault:9600 $(MAKE) app-build
	@docker compose -p standmeet-prod \
		-f docker-compose.prod.yml -f docker-compose.verify-app.yml up -d --no-deps --build app
	@echo "[verify] api-fault on http://localhost:39600 → http://backend:8000"
	@echo "[verify] prod app rebuilt with the rewrite pointing at it"
	@echo "[verify] arm:  curl -XPOST localhost:39600/__mock/fault/arm -d '{\"mode\":\"http_error\",\"path_prefix\":\"/api/admin/roles\"}'"

# verify-api-fault-down —— app 重建回 http://backend:8000，代理停掉。
# **先把 app 摘回来再停代理** —— 反过来的话中间那几秒 app 指着一个已经没了的地址。
# 同样要重建：地址烤在产物里，不重建就一直指着一个已经不在的代理（见上面那段）。
verify-api-fault-down:
	@$(MAKE) app-build
	@docker compose -p standmeet-prod -f docker-compose.prod.yml up -d --no-deps --build app
	@UPSTREAM_BASE_URL=unused docker compose -p standmeet-verify \
		-f docker-compose.verify.yml rm -sf api-fault
	@echo "[verify] prod app back on http://backend:8000"

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

# eval-slots-restated —— UX-93 eval: 时段卡已经把时间摆出来了，答案正文又列一遍（两种截断规则，
# 读的人得自己判断哪份是真的）。**mock 驱不动这条**：正文是模型自己写的，而 mock LLM 只返回测试
# 注册过的那句话 —— 被告不出庭。所以跟 F-A-37 那条一样走真模型 + 真 booker。
# 判据数的是钟点个数（卡在的那一轮，答案里至多一个），不是"感觉重复"。
# 概率性的，多驱几轮：EVAL_ROUNDS=5 make eval-slots-restated。
# eval-owner-identity —— UX-66 eval: 公开切片收窄之后，owner 的 AI 对着陌生人说它不认识 owner。
# 语料**故意不含**介绍 owner 本人的笔记（真 prod 的公开切片就是这样），判据只有一句：
# 不许否认认识那个人。拒绝订会、说没日历都允许 —— 那些是对的答案。
# EVAL_ROUNDS=3 make eval-owner-identity。
eval-owner-identity: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestOwnerIdentityLive -count=1 -v -timeout 1800s ./...

eval-slots-restated: eval-creds
	@$(EVAL_ENV) cd eval-harness && go test -run TestSlotsRestatedLive -count=1 -v -timeout 1800s ./...

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

# eval-compaction —— 多轮 context 臃肿用例,**两条腿**:
#   conv  —— >32K token 长对话,断言压缩真触发 + 压缩后早期**对话事实**召回完整
#   tools —— 历史留在阈值以下,让工具先跑,再由一份大报告把上下文顶过线;断言压缩排在
#            工具之后、那一轮仍答得出只有工具返回过的数字,而且**压缩后零工具调用**
#            (F-D-10:重读一遍也能答对,所以只判答案分不出摘要有没有带走实质)
# **需真 LLM** (harness 自读 eval-harness/.env 的 DeepSeek key;没真 key 不会触发压缩)。
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
# **凭据来源两处，各有其主**：`~/.config/standmeet/verify-creds.env` 是验证凭据的家；而**推理
# key** 归 eval-harness 管（`eval-harness/.env` 的 `EVAL_KEY`，那是它自己跑真模型用的），
# verify-creds 里只留了一行指路的注释 —— 一个密钥抄两份就是两个要轮换的地方。gate 的 BYOAI
# 那一格要的正是「访客把自己的 key 填进表单」，所以驱动器把两处都读进来，plan 里只写变量名
# （见 shoot.mjs 的 `typeSecret`）。eval-harness/.env 不存在时不报错：绝大多数 plan 不需要它。
#
#   make verify-shots PLAN=e2e/manual/plans/seo.json
# turn-hop-probe —— 逼出 /api/v1/agent/turn 那一跳的失败路径（F-O-3）：停 backend → 跨源打一发
# → 断言 502 + 人话 + **带 CORS 头** → 把 backend 拉回来。一条 spec 做不到这件事：它要的前置是
# 「app 活着、backend 够不到」，而整套跑到中途停共享 backend 会把别的 spec 一起带走。
#
#   make turn-hop-probe              # dev
#   make turn-hop-probe STACK=prod   # prod
turn-hop-probe:
	@STACK=$(STACK) e2e/manual/turn-hop-failure-probe.sh

verify-shots:
	@test -n "$(PLAN)" || (echo 'usage: make verify-shots PLAN=e2e/manual/plans/<name>.json'; exit 2)
	@set -a; . $$HOME/.config/standmeet/verify-creds.env; \
	  [ -f eval-harness/.env ] && . ./eval-harness/.env; set +a; \
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
#
# CALLS_FILE= 是同一件事的另一条入口：载荷从文件读。**真语料的正文过不了命令行** ——
# 它带换行、单引号、frontmatter 的 `---`，塞进 `'$(CALLS)'` 要么被 shell 截断要么把引号吃掉。
# 需要把一条真笔记原样发回去（比如验「改正文会不会顺手清掉别的字段」）时走这条。
verify-mcp:
	@test -n "$(CREDS)" || (echo 'usage: make verify-mcp CREDS=<credentials.json> CALLS=<json array>|CALLS_FILE=<path>'; exit 2)
	@# CALLS 用**单引号**包：它是一段 JSON，里面全是双引号，值里还会有空格。双引号那一版
	@# 在参数带空格时 `test` 会收到一串词而不是一个参数，报「too many arguments」——
	@# 看起来像用法写错了，其实是引号错了。
	@test -n '$(CALLS)' -o -n "$(CALLS_FILE)" || (echo 'usage: make verify-mcp CREDS=<credentials.json> CALLS=<json array>|CALLS_FILE=<path>'; exit 2)
	@if [ -n "$(CALLS_FILE)" ]; then \
	  node e2e/manual/mcp-drive.mjs sdk/packages/mcp-client/bin/standmeet-mcp \
	    "$${STANDMEET_VERIFY_HOST:-http://localhost:38227}" "$(CREDS)" "$$(cat $(CALLS_FILE))"; \
	else \
	  node e2e/manual/mcp-drive.mjs sdk/packages/mcp-client/bin/standmeet-mcp \
	    "$${STANDMEET_VERIFY_HOST:-http://localhost:38227}" "$(CREDS)" '$(CALLS)'; \
	fi

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

# dev-fresh —— down + 丢掉 dev 的 pg 卷 + 重新起。**schema 改动之后要跑这个**：
# schema.sql 只在**全新卷**上应用一次，长命的 dev 卷停在它出生时的样子，于是后加的列
# 只活在文件里，backend 照常起来，直到某条查询才炸（[[schema-lives-in-the-volume-not-the-image]]）。
#
# 跟 prod-clean 不同，这条**不要** I_MEAN_IT：dev 里的数据本来就是一次性的（每个 spec
# 自己重置实例），而 prod 的卷装着真语料和真凭据。两条命令危险程度差着量级，
# 不该用同一道门槛 —— 一道人人都懂得绕过的确认，比没有确认更糟。
dev-fresh:
	@docker compose -f docker-compose.dev.yml down --remove-orphans -v
	@$(MAKE) dev-up

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
# `--project=chromium` 是必须写出来的:配置里有两个 project(桌面 + 手机视口),
# 而 playwright 不指定就**两个都跑**。不写的话 `make test` 的时长翻倍,而且手机那一轮
# 的红会混进全量的判据里 —— 那是另一条战线,自己有入口(test-mobile)。
test: dev-up
	@infra/scripts/machine-witness.sh & w=$$!; \
		cd e2e && pnpm exec playwright test --project=chromium; st=$$?; cd ..; \
		kill $$w 2>/dev/null; $(MAKE) archive-failures; exit $$st

# mobile-shots —— 390×844 下每个面各留一张图,产出给人眼看,**不是**功能测试。
# GREP=admin 只驱 admin 那组。图落在 e2e/manual-runs/mobile-sweep/,同名覆盖,
# 所以改完重跑就是同一个文件名的前后对照。
mobile-shots: dev-up
	@cd e2e && pnpm exec playwright test --project=mobile $(if $(GREP),-g "$(GREP)")
	@echo "[mobile] $$(ls e2e/manual-runs/mobile-sweep/*.png 2>/dev/null | wc -l | tr -d ' ') 张 → e2e/manual-runs/mobile-sweep/"

# mobile-shots-asis —— 同上,但不重建、不 up,打正在跑的那套栈。改 CSS 的循环里用这个。
mobile-shots-asis:
	@docker compose -f docker-compose.dev.yml ps --status running --quiet backend | grep -q . \
		|| (echo "[mobile-shots-asis] dev backend is not running — run 'make dev-up' first"; exit 2)
	@cd e2e && pnpm exec playwright test --project=mobile $(if $(GREP),-g "$(GREP)")
	@echo "[mobile] $$(ls e2e/manual-runs/mobile-sweep/*.png 2>/dev/null | wc -l | tr -d ' ') 张 → e2e/manual-runs/mobile-sweep/"

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

# test-asis —— run a spec against **whatever is already running**, no rebuild, no `up`.
#
# This is the ③🧪 recipe from the audit SOP: a new guard must go RED on the UNFIXED code
# before the fix lands. `test-only` depends on `dev-up`, which rebuilds the backend — so it
# builds the fix you just wrote and the guard is green the first time you ever run it. A
# guard whose red was never observed proves nothing ([[assertion-that-cannot-fail]]).
#
# Write the guard, run it here (the containers still hold the old binary) → see the red,
# then `make test-only SPEC=<same>` to rebuild with the fix and see it go green.
#
#   make test-asis SPEC=job-pool-stays-visible
#   make test-asis SPEC=job-pool-stays-visible REPEAT=5
#
# REPEAT is honoured here too. It used to be accepted and silently dropped — you would ask for
# five runs of a suspected flake, get one, and read the pass as five. A recipe that takes a
# variable it does not use reports success for work it never did.
test-asis:
	@test -n "$(SPEC)" || (echo "usage: make test-asis SPEC=<spec-name> [GREP=<title pattern>] [REPEAT=N]"; exit 2)
	@docker compose -f docker-compose.dev.yml ps --status running --quiet backend | grep -q . \
		|| (echo "[test-asis] dev backend is not running — run 'make dev-up' first"; exit 2)
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

# test-boundary —— 把 turn 的时间墙**和它后面那次救场**都调短，跑边界那一格的用例。
#
# 为什么要一个自己的台子：这两个预算是进程级的（300s / 60s）。默认套件里没法在一条用例上
# 把它们改短，于是「撞墙之后产品说什么」这条路**从来没被驱过** —— prod 上真撞到时，
# 访客读到的是一句「连接断了，再问一次」（F-A-44）。
#
# 两个都要短：只调短 turn，救场那 60 秒会把它救回来（那是好路径，另有用例）；要驱的是
# **救场也没来得及**的那一格。BOUNDARY_TIGHT 同时传给测试进程，用例据它自跳，
# 免得它跑进默认套件里变成一条恒定的红（captcha 那五条的教训）。
#
# 台子跑完是短预算的 —— `make dev-up` 放回去。
test-boundary:
	@AGENT_TURN_TIMEOUT=5 FORCE_FINAL_TIMEOUT=3 $(MAKE) dev-up
	@cd e2e && BOUNDARY_TIGHT=1 pnpm exec playwright test $(if $(SPEC),$(SPEC),agent-turn-deadline); \
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

# capture-job-fixtures / trim-job-fixtures —— the job-board equivalents of the two
# above.  Both scripts have existed since the job loop landed and three docs told
# readers to run them "via make", but the recipes were never added — so the only
# way to refresh a fixture was to bypass the house rule and run the script bare.
# capture hits the real boards (rate limits: quarterly, per docs/design/job-loop-tests.md T.9),
# so both take KIND= to refresh a single board:  make capture-job-fixtures KIND=remoteok
capture-job-fixtures:
	@KIND="$(KIND)" bash e2e/fixtures/job-boards/capture.sh

trim-job-fixtures:
	@KIND="$(KIND)" bash e2e/fixtures/job-boards/trim.sh

# backup / restore —— disaster recovery for a self-hosted instance.
#   make backup DEST=/var/backups/standmeet
#   make restore TARBALL=/var/backups/standmeet/standmeet-20260819-101500.tar.gz
# restore is destructive (docker compose down -v wipes the volumes first), so it
# refuses to start without an explicit TARBALL rather than defaulting to anything.
backup:
	@bash infra/scripts/backup.sh "$(or $(DEST),./backups)"

restore:
	@test -n "$(TARBALL)" || { echo "usage: make restore TARBALL=/path/to/standmeet-*.tar.gz"; exit 2; }
	@bash infra/scripts/restore.sh "$(TARBALL)"

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

# prod-redis —— run a redis command against the prod redis.  usage: make prod-redis CMD="info memory"
#
# 跟 prod-psql 同性质的验证栈逃生口。resilience 的 check 1 要的是「有上限、到顶、开始淘汰」这个
# **真状态**，而它只能在活的 redis 上造出来：调低 maxmemory → 灌 → 读 evicted_keys → 调回去。
# 不是 owner 功能。
prod-redis:
	@test -n "$(CMD)" || (echo 'usage: make prod-redis CMD="info memory"'; exit 2)
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis redis-cli $(CMD)

# prod-redis-fill —— 往 prod redis 灌 KEYS 个 300 字节的键，**每个都带 600 秒 TTL**（收工不用打扫，
# 它们自己会走）。给 resilience check 1 造「到顶 + 正在淘汰」那个真状态用；配合 .env 的
# REDIS_MAXMEMORY 临时压低上限。Lua 写在这里而不是从 CMD 传：嵌套引号在 shell 里过不去。
#
#   make prod-redis-fill KEYS=8000
prod-redis-fill:
	@docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis redis-cli eval \
	 "for i=1,tonumber(ARGV[1]) do redis.call('SETEX','verifyfill:'..i,600,string.rep('x',300)) end return redis.call('dbsize')" \
	 0 $(or $(KEYS),8000)

# prod-gate-unlock —— clear the gate's per-IP lockouts on prod.
#
# Driving a lockout by hand (F-G-3's ⑤, F-G-4's ⑤) really locks the gate for fifteen minutes, and
# on a stack with no proxy setting X-Forwarded-For the bucket is `unknown-source` — ONE bucket that
# every visitor shares (F-F-5). So a verification run would lock the door for everyone until the
# TTL runs out. This puts it back immediately.
#
# EVERY per-IP tally, because they lock independently: `codefail:ip:` counts invalid codes,
# `requestflood:ip:` counts notes, `ratelimit:login:` counts login attempts. Clearing only the
# first left the note door shut with nothing on screen to say so — the escape hatch has to know
# about every bucket the mechanism grew (`middleware/ip_tally.go` + `login_guard.go` are where
# they are configured). Add the pattern here in the same commit that adds a tally.
#
# It is a verification-stack escape hatch, not an owner feature: an owner who wants to lift a lock
# solves the captcha, which is the whole point of the surface this exists to test.
GATE_LOCK_PATTERNS = 'codefail:ip:*' 'requestflood:ip:*' 'ratelimit:login:*'
prod-gate-unlock:
	@for p in $(GATE_LOCK_PATTERNS); do \
		docker compose -p standmeet-prod -f docker-compose.prod.yml exec -T redis \
			redis-cli --scan --pattern "$$p" | xargs -r docker compose -p standmeet-prod \
			-f docker-compose.prod.yml exec -T redis redis-cli DEL; \
	done
	@echo "[prod] per-IP lockouts cleared (invalid codes + note flood + login attempts)"

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

# dev-psql-file —— same, for multi-line SQL.  usage: make dev-psql-file FILE=/tmp/x.sql
# The one-liner form goes through the shell twice, so a `$` inside the SQL (a regex anchor, say)
# arrives mangled and postgres reports a syntax error in a statement you did not write.
dev-psql-file:
	@test -f "$(FILE)" || (echo 'usage: make dev-psql-file FILE=<path.sql>'; exit 2)
	@docker compose -p standmeet-dev -f docker-compose.dev.yml exec -T db \
		psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 < "$(FILE)"

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

# ── release: 把镜像推到 registry ─────────────────────────────────
#
# 一个仓库有两条把字节送出去的路，它们各自看得见的东西不一样：
#
#   `git push`  → 整部**历史**。在后面某次提交里删掉的密钥，推上去照样在。
#   registry    → **镜像文件系统**。`.gitignore` 对它没有发言权，`.dockerignore` 才有 ——
#                 而这两张单子不是同一张。本机此刻就躺着真凭据（`.playwright-mcp/` 里
#                 一份 Google OAuth client-secret 和几个 PEM、`eval-harness/.env`）：
#                 它们进不了 git，进不进镜像是另一个问题，由另一张单子回答。
#
# 所以推之前两条都扫：`secrets` 扫历史 + 暂存区，`secrets-image` 扫**镜像本身**。
#
# **为什么扫镜像而不是扫它的构建上下文**：上下文是替身。判据要落在真的要发出去的那个东西
# 上 —— `.dockerignore` 少写一条、Dockerfile 里多一句 COPY，上下文扫描都看不见，镜像扫描
# 看得见。
REGISTRY ?= ghcr.io/atmaxmoj

# TAG —— **从 git tag 反解，不手填**。打了 `v0.0.1` 的那一笔上它就是 `v0.0.1`；之后的提交是
# `v0.0.1-3-gabc1234`，一眼看得出「这不是那个发布」。版本号只有一个家（[[事实归产生它的那一方]]）——
# Makefile 里再抄一份的话，「记得改版本号」就成了一条迟早没人记得的规矩。
TAG ?= $(shell git describe --tags --always --dirty)

# db 也在里面：Coolify 的「粘贴一份 compose」没有仓库，`./backend/db/schema.sql` 那种
# 相对挂载在那里必然挂空 —— 而 postgres 挂空的表现是**静默起一个空库**。把 schema 烤进
# 镜像，注册表部署就一处挂载都不需要（infra/db/Dockerfile）。
IMAGES := backend app builder im-bridge db

# release-build —— 按 REGISTRY/TAG 把四个镜像建出来（不推）。
# app 的 .next 由宿主构建后 COPY 进镜像，所以它必须先跑。
#
# context / dockerfile / target 跟 docker-compose.prod.yml 同源。用 `docker build` 而不是
# `compose build`：`compose images -q` 查的是**运行中的容器**，没起容器就返回空串，于是打标
# 那一步拿到一个空的源（第一次就是这么炸的）。发布不需要起任何容器。
#
# ── 这里不复用 `app-build`，因为发布的 app 是**另一种构建** ──────────────────────────
#
# `next.config.ts` 早就声明了 dual-build：`STRIP_TEST_HOOKS=1` 时 SWC 在编译期把
# `data-testid` 全部剥掉，注释写的是「真正发布给访客的 build」设它。
# 而这个变量**全仓库只出现在那一个文件里** —— 没有任何地方设过（F-A-45）。
# 于是至今每一个 app 镜像都把 804 处 testid 原样送给访客：它们是内部组件结构的说明书，
# 也是给抓取/自动化用的稳定选择器 —— 而验证码和限流那一整套机制正是要让自动化变贵。
#
# **只在这条路上剥**：dev 的 e2e 靠 testid 定位，prod 栈上的真环境审计也靠它驱动。
# 那两条都不是「发给访客的 build」。
# RELEASE_PLATFORMS —— 发布的镜像必须是**多架构**的。
#
# 这一条是踩出来的：v0.0.3 在 Mac 上构建，五个镜像全是 linux/arm64。推上 ghcr、
# 部署到一台 x86_64 的服务器 —— **拉得下来、跑不起来**，每个容器启动即退。
# 现象骗人得厉害：db / redis / minio 这些跟我配置毫无关系的也一起退，
# 于是看起来像整份 compose 有问题，而我为此逐个排除了变量展开、镜像可见性、
# compose 解析、卷命名四类原因，每类一轮。真正的差别是「我这台是 arm64」。
#
# 自托管的人用什么机器不由我们决定，所以发布面必须覆盖两种。
RELEASE_PLATFORMS ?= linux/amd64,linux/arm64

release-build: sdk-build builder-vendor
	@pnpm install --frozen-lockfile
	@STRIP_TEST_HOOKS=1 pnpm -F standmeet-app build
	@$(MAKE) release-assert-stripped
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  echo "[release] building $$img"; \
	  case $$svc in \
	    backend)   docker build -t $$img -f backend/Dockerfile --target production . ;; \
	    app)       docker build -t $$img ./app ;; \
	    builder)   docker build -t $$img ./builder ;; \
	    im-bridge) docker build -t $$img -f im-bridge/Dockerfile . ;; \
	    db)        docker build -t $$img -f infra/db/Dockerfile . ;; \
	  esac || exit 1; \
	  docker tag $$img $(REGISTRY)/standmeet-$$svc:latest || exit 1; \
	done
	@echo "[release] built: $(IMAGES) @ $(TAG)"

# release-assert-stripped —— **证明剥掉了**，不是相信它剥掉了。
#
# 这个开关活在 next.config.ts 的一个字符串比较里：改个名、升一次 Next、动一下 compiler 那段，
# 它都会静默失效 —— 而失效的样子跟生效一模一样（镜像照样建出来、照样能跑）。
# 所以这一步既判「剥干净了」，也判「我确实扫到了东西」：产物目录为空的话，
# 「零个 testid」是一句没有意义的真话。
# 三处豁免，每一处都是**机械的**（按路径），不是一份 testid 名单：
#   · node_modules —— Next 自己的 devtools 包里有 `data-testid="geist-icon"`。别人的代码。
#   · server.js / required-server-files.json —— 那里面是**配置回声**
#     （`"reactRemoveProperties":{"properties":["^data-testid$"]}`），不是元素上的属性。
#     它出现恰恰说明剥这件事配上了。
#   · /admin/ —— 这条规则剥的是 **JSX 属性**；交给第三方库的**对象键**（Tiptap 的
#     `editorProps.attributes`）它结构上看不见。那一处在 owner 的编辑器上，
#     而这个开关声明的目的是「发给访客的 HTML 干净」—— 访客到不了 /admin。
release-assert-stripped:
	@test -d app/.next/standalone || { echo "release: app/.next/standalone 不存在 —— 没扫到东西，'零个 testid' 不算数"; exit 2; }
	@files=$$(find app/.next/standalone -type f -not -path '*/node_modules/*' | wc -l | tr -d ' '); \
	  test "$$files" -gt 100 || { echo "release: 扫描面只有 $$files 个文件，不对"; exit 2; }; \
	  hits=$$(grep -rl "data-testid" app/.next/standalone 2>/dev/null \
	    | grep -v '/node_modules/' \
	    | grep -v '/server\.js$$' \
	    | grep -v '/required-server-files\.json$$' \
	    | grep -v '/app/admin/'); \
	  test -z "$$hits" || { \
	    echo "release: 访客侧的产物里还有 data-testid —— STRIP_TEST_HOOKS 没生效，或者"; \
	    echo "         有人把 testid 当对象键传给了库（那样剥不掉，得挪成 JSX 属性）："; \
	    echo "$$hits" | sed 's/^/           /'; exit 1; }; \
	  echo "[release] 访客侧产物已剥 testid（扫了 $$files 个文件）"

# secrets-image —— 扫**要发出去的那个镜像的文件系统**。
#
# `docker export` 出来的就是这个镜像的 rootfs，不是它的近似。
#
# **它挡的到底是什么**：git 那道闸门只看得见被跟踪的文件。而镜像里有什么由 `.dockerignore`
# 决定 —— 一个 git 忽略的文件照样进得了镜像。本机此刻就有真凭据处在这个位置
# （`.playwright-mcp/` 下的 Google OAuth client-secret 和 PEM、`eval-harness/.env`）：
# 它们进不了历史，所以只有这道闸门可能拦得住。
#
# **它覆盖不到的**（明说，别让 "all images clean" 读起来像全覆盖）：
#   · gitleaks 跳过二进制。backend 镜像 77 MB，扫到的是 3.7 MB —— 那个 Go 可执行文件没扫。
#     可以接受的理由是它里面的字符串只能来自**源码**（历史那道扫过）或 build arg（我们一个
#     都不传），不是因为扫过了。
#   · 下面排除的是**基础镜像自带的目录**（node 的头文件、系统库、第三方依赖树）。那些字节
#     不是我们放进去的，上游原样带来的。我们自己 COPY 的东西（/app、/srv、二进制）都在扫描面内。
#     其中两条是 db 镜像加进来时补的，各自核实过来路：
#       `etc/ssl/private/` —— Debian `ssl-cert` 包在 postinst 生成的自签名占位证书
#         （snakeoil）。`pgvector/pgvector:pg16` 这个上游镜像里本来就有；这套栈连库走
#         `sslmode=disable`，它是死的。
#       `usr/lib/` —— 发行版的库和头文件（那次报的是 perl 的 CORE/cop.h）。
#     两条都验过：五个 Dockerfile 没有一个往这两处写东西，所以排除它们不会遮住我们自己的字节。
secrets-image:
	@command -v gitleaks >/dev/null 2>&1 || { \
	  echo "secrets-image: gitleaks is not installed — this gate cannot run."; \
	  echo "               install it rather than skipping: a skipped secret scan"; \
	  echo "               reports success for work it did not do."; exit 2; }
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  docker image inspect $$img >/dev/null 2>&1 || { \
	    echo "secrets-image: $$img not built — run 'make release-build' first"; exit 2; }; \
	  echo "[secrets-image] $$img"; \
	  d=$$(mktemp -d); \
	  cid=$$(docker create $$img); \
	  docker export $$cid | tar -x -C $$d \
	    --exclude='*node_modules*' --exclude='*site-packages*' \
	    --exclude='usr/local/go/*' --exclude='root/go/pkg/*' \
	    --exclude='usr/include/*' --exclude='usr/local/include/*' \
	    --exclude='usr/share/*' --exclude='usr/lib/*' \
	    --exclude='etc/ssl/private/*' 2>/dev/null || true; \
	  docker rm -f $$cid >/dev/null; \
	  wd=$$(docker image inspect $$img --format '{{.Config.WorkingDir}}'); \
	  can=$$d$${wd:-}/.sm-secrets-canary.txt; \
	  mkdir -p $$(dirname $$can); \
	  printf 'aws_secret_access_key = "%s"\n' \
	    "$$(head -c 30 /dev/urandom | base64 | tr -d '/+=' | head -c 40)" > $$can; \
	  rep=$$(mktemp -t sm-secrets-XXXX).json; \
	  gitleaks dir $$d --config .gitleaks.toml --no-banner --redact \
	    --report-format json --report-path $$rep >/dev/null 2>&1; \
	  python3 infra/scripts/secrets-image-verdict.py $$rep $$d "$$img" \
	    "$${wd:-}/.sm-secrets-canary.txt"; st=$$?; \
	  rm -rf $$d $$rep; \
	  [ $$st -eq 0 ] || exit $$st; \
	done
	@echo "[secrets-image] all $(words $(IMAGES)) images clean"

# release-repro —— 拿**已发布的镜像**在本机把一份 compose 跑起来，为的是看日志。
#
# 存在的理由：远端那台 Coolify 是 4.1.2，而容器/服务日志的 API 端点是 **4.2.0 才加的**
# （查了 changelog 才知道，不是路径写错）。那台又进不去 SSH。于是「容器为什么退出」
# 在那台机器上拿不到。
#
# 但那是「拿不到**那台**的日志」，不是「拿不到日志」：镜像是公开的、compose 读得到，
# 同一份东西在本机跑一遍，日志全在手上。用它排查线上起不来的问题，比逐个假设去试便宜得多。
#
#   make release-repro FILE=<compose 路径>        起来
#   make release-repro-logs FILE=<同一份>          看日志
#   make release-repro-down FILE=<同一份>          收摊
REPRO_PROJECT ?= smrepro
release-repro:
	@test -n "$(FILE)" || (echo "usage: make release-repro FILE=<compose.yml>"; exit 2)
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) up -d --remove-orphans || true
	@echo "[repro] 起完了。看日志: make release-repro-logs FILE=$(FILE)"

release-repro-logs:
	@test -n "$(FILE)" || (echo "usage: make release-repro-logs FILE=<compose.yml>"; exit 2)
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) ps
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) logs --tail=$(LINES) 2>&1 | tail -n 200

release-repro-down:
	@test -n "$(FILE)" || (echo "usage: make release-repro-down FILE=<compose.yml>"; exit 2)
	@docker compose -f $(FILE) -p $(REPRO_PROJECT) down -v --remove-orphans

# release-push —— **多架构**构建并推。两道密钥闸门是它的前置，绕不过去。
#
# 为什么这里重新构建一次而不是 `docker push` 本地那份：多架构镜像**装不进本地 daemon**
# （一个 tag 只能装一个平台），只能 buildx 直接推。`release-build` 那一份仍然有用 ——
# 它是 `secrets-image` 扫的对象，也是本机复现用的那份。
#
# 两者的字节差别只在基础镜像的二进制上：我们自己 COPY 的东西逐字一样，
# 所以扫本地那份对「有没有把密钥打进去」这个问题是有效的。
#
# 登录不在这里：`docker login ghcr.io` 要一个 PAT，那是 owner 自己敲的东西。
release-push: secrets secrets-image
	@docker buildx inspect standmeet-release >/dev/null 2>&1 \
	  || docker buildx create --name standmeet-release --driver docker-container >/dev/null
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  echo "[release] buildx --push $$img ($(RELEASE_PLATFORMS))"; \
	  case $$svc in \
	    backend)   ctx="-f backend/Dockerfile --target production ." ;; \
	    app)       ctx="./app" ;; \
	    builder)   ctx="./builder" ;; \
	    im-bridge) ctx="-f im-bridge/Dockerfile ." ;; \
	    db)        ctx="-f infra/db/Dockerfile ." ;; \
	  esac; \
	  docker buildx build --builder standmeet-release \
	    --platform $(RELEASE_PLATFORMS) \
	    -t $$img -t $(REGISTRY)/standmeet-$$svc:latest \
	    --push $$ctx \
	    || { echo "[release] push failed — logged in? docker login ghcr.io"; exit 1; }; \
	done
	@$(MAKE) release-assert-multiarch
	@echo "[release] pushed $(IMAGES) @ $(TAG) + latest to $(REGISTRY)"

# release-assert-multiarch —— **推上去的 manifest 必须真的含 amd64**。
#
# 不是多此一举：v0.0.3 就是全 arm64 推出去的，拉得下来、在 x86_64 上跑不起来，
# 而症状是「所有容器启动即退」—— 看起来像 compose 坏了。一次 `--platform` 写漏、
# 一次 buildx builder 退化成默认 driver，都会静默地把发布面缩回一种架构。
# 所以判结果，不判命令。
release-assert-multiarch:
	@for svc in $(IMAGES); do \
	  img=$(REGISTRY)/standmeet-$$svc:$(TAG); \
	  archs=$$(docker manifest inspect $$img 2>/dev/null \
	    | python3 -c "import sys,json;d=json.load(sys.stdin);print(' '.join(sorted({m['platform']['architecture'] for m in d.get('manifests',[]) if m['platform']['architecture']!='unknown'})))"); \
	  case "$$archs" in \
	    *amd64*) echo "  $$svc: $$archs" ;; \
	    *) echo "release: $$img 不含 amd64（只有 '$$archs'）—— x86_64 的机器拉得到但跑不起来"; exit 1 ;; \
	  esac; \
	done
	@echo "[release] 五个镜像都含 amd64 ✓"

# 这里曾经有一个单架构的 `docker push` 版本。删掉而不是留着：它推出去的正是
# v0.0.3 那种只在 arm64 上能跑的镜像，而留着一个能把缺陷重新引入的入口，
# 迟早有人走它。发布只有 buildx 这一条路。
