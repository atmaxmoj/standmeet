# StandMeet Build Plan

> **协议：** 每个 milestone 以"一个特定 E2E 测试跑通"为完成判定 —— 不是"代码写完"也不是"lint 过"。E2E 没绿不算完成。
>
> **顺序：** 串行执行，干完一个再下一个。每个 M 完成后 commit 一次（消息形如 `feat(M3): owner login + session`）。
>
> **DoD（Definition of Done）每个 milestone 必须满足：**
> 1. 列出的 E2E 测试在 `make test` 下绿
> 2. `make lint` 绿（含本 M 新增的代码）
> 3. 涉及的容器 `docker compose -f docker-compose.dev.yml up -d` 能起来
> 4. 当本 M 引入新设计稿决策点时，`docs/design/code-architecture.md` 同步
>
> **测试纪律（M7 立的，倒回去补 M2-M6）:**
> - **所有 e2e 必须 UI-driven**。Playwright 真起浏览器，模拟用户点击/输入，看 DOM。
> - **API-only 测试不算 e2e**。绕过 UI 直接 POST 的 spec 不是"集成测试更省事"，是"漏掉了真正的用户路径"。
> - **测试按 business 命名，不按 milestone 命名**。`public-page.spec.ts` 不是 `m7.spec.ts`。一年后看 spec 列表要能直接读懂在测什么用户场景。
> - **Setup 通过 helper 走 API**（claim instance、seed corpus 这种）是允许的；只要被测路径本身走浏览器即可。MCP 协议本身就是 owner 的 user surface（owner 用 Claude Desktop 等 MCP client）—— 仿真 MCP client 算 UI-driven。
> - **M2-M6 的 e2e specs 都已删除**。M2-M4 的 admin 流程要等 M8 admin UI 落地后用 UI 重写；M5 在 M8 同时补回（owner 在 admin 看 corpus list 是 UI 流程）；M6 的功能被 M7 的 public-page.spec.ts 完全覆盖。

---

## 进度速览

| # | Milestone | 状态 |
|---|-----------|------|
| M1 | Backend 健康端点跑通 + dev compose 起得来 | ✓ done (7930a3f) |
| M2 | First-run instance claim | ✓ done |
| M3 | Owner login + session + admin /me | ✓ done |
| M4 | API token + MCP server hello | ✓ done |
| M5 | Corpus ingest (MCP write tools + admin list) | ✓ done |
| M6 | Access codes + visitor session + chat (SSE + RAG) | ✓ done |
| M7 | Public web surface (index + chat embed) | ✓ done |
| M8 | Admin web surface (login UI + 6 sections) | pending |
| M9 | BYOAI + gate + SEO (sitemap/robots/og/wiki landing) | pending |
| M10 | Custom pages（MCP + 沙箱 builder + middleware rewrite） | pending |
| M11 | SDK 抽出 + Caddy 自动 SSL + 一键 install | pending |

---

## M1 — Backend 健康端点 + dev compose

**目标：** 证明整套 toolchain 闭环。Go binary 起来、PG/Redis 起来、`curl /internal/healthz` 返回 200。

**做什么：**
- `backend/cmd/server/main.go` —— chi router + slog + 监听 `:8000`
- `backend/internal/config/` —— 从 env 读 `DATABASE_URL`、`REDIS_URL`、`PORT`
- `backend/internal/routes/internal/health.go` —— `GET /internal/healthz` 检查 PG + Redis 可达
- `backend/internal/postgres/conn.go` —— pgx pool 包一层
- `backend/go.mod` —— init module
- `backend/entrypoint.sh` —— 启动前预留 `goose up`（M2 用），现在直接 exec
- 根 `docker-compose.dev.yml` —— backend + db (pgvector/pgvector:pg16) + redis
- 根 `.env.example`、`.env`
- `lefthook install`（M1 起开始用 git hook）

**E2E（绿色判定）：**
- `e2e/test/m1-healthz.spec.ts` —— Playwright 访问 `http://localhost:8000/internal/healthz`，断言 200 + body `{"ok": true, "db": "ok", "redis": "ok"}`
- 跑法：`make dev-up && make test`

---

## M2 — First-run instance claim

**目标：** 干净 instance 启动 → console 打印 setup URL → 浏览器走完 claim → owners 表有一行 + `is_claimed=true`。

**做什么：**
- `backend/db/schema.sql` —— `owners` + `instance_settings` 两张表
- `backend/db/migrations/0001_init.sql` —— goose up/down
- `backend/db/queries/owners.sql` + `instance_settings.sql` —— sqlc 输入
- `backend/sqlc.yaml`
- `backend/internal/postgres/` —— sqlc generate 产物 + Repository 实现（LoadOrCreate for instance_settings，照 [[legacy-gems]] B1）
- `backend/internal/session/claim.go` —— setup_token 生成 + 校验 + 一次性消费；启动时打印到 stdout + 写 `/srv/first-run.txt`
- `backend/internal/routes/admin/claim.go` —— `POST /api/admin/claim {token, email, password, handle, full_name}`
- `backend/entrypoint.sh` —— 实际跑 `goose up`
- domain types: `Owner`、`InstanceSettings`

**E2E（绿色判定）：**
- `e2e/test/m2-claim.spec.ts` —— docker compose down -v 起干净 instance → `docker compose logs backend` 抓 setup URL → 浏览器开页面（暂无 setup UI，直接 POST）→ 断言 owners 表多了一行 + is_claimed=true → 第二次调拒绝

---

## M3 — Owner login + session + admin /me

**目标：** 已 claim 的 instance 能登录拿 session cookie，`/api/admin/me` 返回 owner profile。

**做什么：**
- `backend/internal/session/session.go` —— Redis-backed session（key `session:{token}` → owner_id, expires_at, csrf_token）
- `backend/internal/session/password.go` —— Argon2id hash/verify
- `backend/internal/middleware/auth.go` —— `WithOwner` 从 cookie 解 owner，挂 ctx
- `backend/internal/routes/admin/auth.go` —— `POST /api/admin/login`、`POST /api/admin/me/logout`、`GET /api/admin/csrf`
- `backend/internal/routes/admin/me.go` —— `GET /api/admin/me`
- middleware: CSRF double-submit

**E2E（绿色判定）：**
- `e2e/test/m3-login.spec.ts` —— claim 创建 owner → 错密码登录拒绝 → 正确密码登录拿 cookie → 用 cookie 调 /api/admin/me 返回 owner → logout → 同 cookie 再调拒绝

---

## M4 — API token + MCP server hello

**目标：** owner 在 admin 建一个 API token，用它调 MCP server 的 `me()` 工具，返回 owner 信息。

**做什么：**
- `backend/db/migrations/0002_api_tokens.sql` —— api_tokens 表（对齐 [[youteacher]]：name + token_hash + scopes default `{*}` + last_used_at；无 prefix/revoked_at）
- `backend/internal/session/api_token.go` —— `smk_<24-char-base32>` 生成 + sha256 存 + verify
- `backend/internal/routes/admin/tokens.go` —— CRUD（创建返回明文一次；删 = 硬删）
- `backend/internal/mcp/server.go` —— mcp-go server 挂 `/mcp/`，鉴权用 bearer + api_token verify
- `backend/internal/mcp/tools/me.go` —— `me()` 工具返回 owner info

**E2E（绿色判定）：**
- `e2e/test/m4-mcp-hello.spec.ts` —— login 后 POST /api/admin/tokens → 拿到明文 smk_xxx → 用 smk_xxx 调 `POST /mcp/` `tools/list` 看到 me → 调 me() 返回 owner → 硬删 token → 同 token 再调拒绝

---

## M5 — Corpus ingest（MCP write tools + admin list）

**目标：** AI 通过 MCP 把 insight 推进 corpus，admin endpoint 能拉列表看到。

**做什么：**
- `backend/db/migrations/0003_corpus.sql` —— raw_entries + wiki_entries + media_assets
- `backend/db/queries/raw.sql` + `wiki.sql` + `media.sql`
- `backend/internal/domain/` —— RawEntry / WikiEntry / MediaAsset
- `backend/internal/usecases/promote_raw.go`、`raw_dump.go`、`upload_media.go`、`set_tags.go`
- `backend/internal/mcp/tools/raw.go`、`wiki.go`、`media.go` —— 全套 MCP write tools
- `backend/internal/routes/admin/raw.go` + `wiki.go` —— GET list、PATCH、DELETE
- request_id idempotency（设计稿 D.5）：1 小时窗口 dedupe

**E2E（绿色判定）：**
- `e2e/test/m5-ingest.spec.ts` —— 用 M4 的 token 调 `raw_dump(body="...", tags=["test"])` → admin GET /api/admin/raw 看到那条 → `promote_to_wiki(raw_id, title, visibility="public")` → admin GET /api/admin/wiki 看到 → 同 `request_id` 重发 raw_dump 不重复写

---

## M6 — Access codes + visitor session + chat (SSE + RAG)

**目标：** owner 建一个 access code，访客用 code 创 session 然后发问题，收到流式回复 + citation。

**做什么：**
- `backend/db/migrations/0004_codes_chat.sql` —— access_codes + code_members + conversations + messages
- `backend/internal/domain/code.go` + `conversation.go`
- `backend/internal/usecases/issue_code_session.go` —— code 校验 + identity picker + 颁发 visitor session
- `backend/internal/session/visitor.go` —— Redis-backed visitor session，参考 [[legacy-gems]] A3：active query 不可驱逐
- `backend/internal/routes/admin/codes.go` —— code CRUD
- `backend/internal/routes/public/sessions.go` —— `POST /api/v1/sessions`
- `backend/internal/routes/public/messages.go` —— `POST /api/v1/sessions/:id/messages` (SSE)
- `backend/internal/inference/anthropic.go` —— anthropic client + RAG（embedding 检索 wiki + scope filter）
- pgvector embedding 写入：异步 worker goroutine 监听 raw → wiki promote 事件

**E2E（绿色判定）：**
- `e2e/test/m6-visitor-chat.spec.ts` —— admin 创建 code `INTERVIEW-XXX`，scope `included_tags=['work']` → 用 code POST /api/v1/sessions → 拿 session_token → POST /api/v1/sessions/:id/messages with `{content: "what did you build last?"}` → SSE 流回 token delta → done event → DB messages 表有 visitor + assistant 两条 + cited_wiki_ids 非空

---

## M7 — Public web surface（index + chat embed）

**目标：** 浏览器访问 `/` 看到默认 owner 公开页（hero + insights + projects），有 chat input，发问题流式渲染回复。

**做什么：**
- `app/package.json` + Next.js 起步、Tailwind 4 配置、Newsreader + JetBrains Mono 引入
- `app/src/lib/design/` —— color token、密度变量、dark mode
- `app/src/lib/api/public.ts` —— public API client (`/api/v1/*`)
- `app/src/app/(public)/[handle]/page.tsx` —— SSR long-scroll，从 `/api/v1/page/:handle` 拉数据
- `app/src/components/ChatDock.tsx` —— SSE 消费 + ref-batched 渲染（参考 [[legacy-gems]] A1）
- `app/src/components/InsightsSection.tsx` 等
- `backend/internal/routes/public/page.go` —— `GET /api/v1/page/:handle`、`POST /api/v1/page` (admin) ... 留 admin endpoint 到 M8
- `backend/db/migrations/0005_page_content.sql` —— page_content 表

**E2E（绿色判定）：**
- `e2e/test/m7-public-chat.spec.ts` —— Playwright 浏览器访问 `http://localhost:3000/` → 断言看到 owner hero / insights / projects → 在 chat input 输入"What are you working on?" → 看到 streaming reply token by token → 最后一条 assistant 消息有 citation 块

---

## M8 — Admin web surface（login UI + 6 sections）

**目标：** owner 在浏览器里 login，admin 完整 6 sections 可用（raw / wiki / conversations / codes / connectors / page / api·mcp）。

**做什么：**
- `app/src/app/(auth)/login/page.tsx` —— login 表单
- `app/src/app/(auth)/setup/page.tsx` —— first-run claim 表单（带 setup token query string）
- `app/src/app/(admin)/admin/[[...slug]]/page.tsx` —— admin SPA 入口
- `app/src/components/admin/` —— RawList、WikiList、CodeList、ConversationList、PageEditor、ConnectorTiles、ApiTokens
- `app/src/lib/api/admin.ts` —— admin API client + CSRF
- `backend/internal/routes/admin/page.go` —— `GET/PUT /api/admin/page`
- `backend/internal/routes/admin/conversations.go`、`connectors.go`

**E2E（绿色判定）：**
- `e2e/test/m8-admin.spec.ts` —— 浏览器访问 `/login` → 登录 → 跳转 `/admin` → 看到 6 sections nav → 进 Raw → 看到 M5 的 raw entry → 进 Page → 改 hero_prose → 保存 → 浏览器访问 `/` 看到改动生效

---

## M9 — BYOAI + gate + SEO

**目标：** 无码访客访问 gate 页 → 填自己的 API key → public-scope chat 跑通；爬虫拿 sitemap.xml + robots.txt + 一个 wiki landing 页。

**做什么：**
- `app/src/app/(public)/[handle]/gate/page.tsx` —— gate UI（code entry + BYOAI panel + request access）
- `app/src/lib/byoai/` —— client-side 直连 Anthropic/OpenAI（设计稿 D.2），不经过 server
- `backend/internal/routes/public/sessions.go` —— byoai session 颁发（visibility 强制 public）
- `backend/internal/routes/public/seo.go` —— `GET /robots.txt`、`/sitemap.xml`
- `backend/internal/routes/public/wiki_landing.go` —— `GET /api/v1/wiki/:handle/:seo_slug`
- `app/src/app/api/og/page/[handle]/route.ts` —— next/og 渲染 OG image（设计稿 J.1）
- `backend/db/migrations/0006_seo.sql` —— wiki seo_* fields + seo_settings 表
- `backend/internal/routes/admin/seo.go` + MCP `seo.*` tools

**E2E（绿色判定）：**
- `e2e/test/m9-byoai-seo.spec.ts` —— 访问 /gate 看到 BYOAI panel → 填 fake key（mock anthropic endpoint）→ 跳到主页 + BYOAI banner → 发 public 问题成功 / 发 private 问题被 redirect → curl /robots.txt 正确 → /sitemap.xml 有默认页 → admin 给一条 wiki 打开 SEO landing → curl /api/v1/wiki/sijie/<slug> 200

---

## M10 — Custom pages（MCP + 沙箱 builder + middleware rewrite）

**目标：** owner 在 Claude Desktop 让 AI 创建 `/blog` 页，AI 写 React 源码 → 沙箱 build → promote_to_staging → owner 看 staging URL → promote_to_live → 浏览器访问 `/blog` 看到 custom page。

**做什么：**
- `backend/db/migrations/0007_custom_pages.sql` —— custom_pages + custom_page_builds
- `backend/internal/sandbox/spawn.go` —— `docker run --rm --network=none ...` 包一层
- `builder/Dockerfile` + `builder/runner.mjs` —— 沙箱镜像，读 source + 跑 vite build → 写 dist
- `builder/template/App.tsx` —— 起步模板用 @standmeet/sdk
- `backend/internal/usecases/custom_page.go` —— allowlist 校验 + build coalescing（设计稿 D.6）
- `backend/internal/mcp/tools/custom_page.go` —— 全套 `custom_page.*` tools
- `backend/internal/routes/admin/custom_pages.go` —— lifecycle（publish/rollback/unpublish/delete）
- `app/src/middleware.ts` —— 路径 lookup → rewrite 到 custom page 静态产物（参考 [[legacy-gems]] A2）

**E2E（绿色判定）：**
- `e2e/test/m10-custom-page.spec.ts` —— 用 MCP token 调 `custom_page.create('/blog')` → write_file App.tsx with 一段 hello → build → 轮询 get_build 直到 built → promote_to_staging 拿 URL → 浏览器访问 staging URL 看到 hello → promote_to_live → 浏览器访问 `/blog` 看到 hello → rollback → `/blog` 回到默认

---

## M11 — SDK 抽出 + Caddy 自动 SSL + 一键 install

**目标：** `@standmeet/sdk` npm 包跑得起来（web 自己 dogfood），Caddy 反代 + 自定义域名自动 SSL，`./install.sh` 一行起 instance。

**做什么：**
- `sdk/packages/core/src/` —— API client、types、SSE 状态机（从 app/ lib/api 抽）
- `sdk/packages/react/src/` —— `<StandMeetChat>`、`<StandMeetContent>` 等组件（从 app/ components 抽）
- `sdk/packages/embed/src/` —— Web Components 包装
- `app/` 改成 dogfood：删 `lib/api/public.ts`，用 `@standmeet/sdk` 引入
- 根 `Caddyfile` —— 反代 + on-demand TLS
- `backend/internal/routes/internal/tls_ask.go` —— `GET /internal/tls-ask?domain=`
- `infra/scripts/install.sh` —— 一行起 docker compose + 提示 setup URL
- `infra/scripts/backup.sh` + `restore.sh`

**E2E（绿色判定）：**
- `e2e/test/m11-deploy.spec.ts` —— 在干净的 `make demo-fresh`（脚本：rm -rf volumes → docker compose up → tail log 拿 setup URL）下 → 浏览器开 setup URL 走完 claim → admin 加 custom_domain → mock DNS verify → Caddy 自动反代（用 caddy 的 staging endpoint 测）→ 通过 custom_domain 访问公开页 200

---

## 路径外（未编号，按需）

- M12（如做）：Owner ingest 外延 —— Electron client 对齐 + IM bridge (TG/Discord/Slack) 对齐到新数据模型
- M13（如做）：Connectors 真接 OAuth —— Gmail / Calendar
- M14（如做）：多租户开关 —— `instance_settings.multi_tenant=true` 启用 /signup + 路径切换

---

## 工作节奏

- 每个 M 开始时建一个 TaskCreate，过程中拆子 task；M 完成时全部 mark completed
- 每个 M 完成 commit 一次。Commit 信息以 `feat(Mn): <一句话总结>` 起头
- 遇到设计稿要改的，对应章节同步 commit `docs(architecture): adjust Mn finding`
- 遇到 legacy 要参考的，去 [[legacy-gems]] 拿位置
- 任何 milestone 卡住超过当天，回头给 owner 报状态再决定要不要拆得更细

**当前位置：** 即将启动 M1。
