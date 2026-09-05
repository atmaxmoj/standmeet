# StandMeet 代码架构

> **状态：** 草稿，待 owner 评审（2026-05-16 修订；后端切换为 Go，builder 改为 MCP 驱动工作流）。
> **读者：** 实际要把这套东西写出来的人。默认你已经读过 `CLAUDE.md` 了解产品语境，读过 `docs/design/chats/chat1.md` 了解视觉意图。
> **怎么反馈：** 每块结尾有编号的决策点（`A.1`、`A.2`、…）。回 `Aₙ: accept` 或 `Aₙ: change — <理由 / 新方向>`。没提到的视作 accept。

---

## TL;DR — 整套系统的形状

```
                ┌─── 80 / 443 ───┐
                │     Caddy      │  ← 自动 Let's Encrypt + 自定义域名 on-demand TLS
                └────┬───────────┘
        ┌────────────┼─────────────────────┐
        │            │                     │
   ┌────▼────┐  ┌────▼─────┐         ┌─────▼──────┐
   │   app   │  │ backend  │         │  /custom   │
   │ Next.js │  │   Go     │         │  静态产物   │
   │ :3000   │  │  +chi    │         │ （volume） │
   └─────────┘  │ +mcp-go  │         └────────────┘
                │  :8000   │
                └────┬─────┘
            ┌────────┼─────────┐
       ┌────▼──┐ ┌───▼────┐ ┌──▼──────────┐
       │  PG   │ │ Redis  │ │  Builder    │
       │ pgvec │ │        │ │  沙箱       │
       └───────┘ └────────┘ │ （按构建启） │
                            └─────────────┘
```

5 个常驻容器（caddy / app / backend / pg / redis）+ 1 个按需容器（builder），由 backend 在 owner AI 客户端调 MCP 工具时拉起。单一 docker compose。自部署，一条命令起服务。

### 关于 builder 的一段话

`microsites`（每个 owner 可有多个 slug）**完全通过 owner 自己 AI 客户端里调的 MCP 工具来创作**（Claude Desktop、Cursor 之类）。admin 里的 "Microsites" 区只是一个**监控面板**——列表、状态、staging URL、publish/rollback——它**不**承载编辑器、聊天框或预览框。AI 推理的钱走 owner 已有的 AI 订阅，StandMeet 后端只为沙箱 build 付钱。

---

## A. 系统拓扑

### 约束

- 一条命令起整套（`docker compose up -d`）。
- instance 自己的域名 + owner 自定义域名都自动 SSL。
- v1 单 owner；数据层为多租户预留。
- SDK 跑在第三方浏览器里 —— API 必须 CORS 友好。
- MCP server 要让 owner 的 AI 客户端通过 HTTPS 能调到。
- Page builder 沙箱要跑 owner 提供的代码，必须隔离。

### 推荐形态

5 个常驻服务：

1. **`caddy`** — 反向代理、TLS 终端、自定义域名 on-demand TLS。
2. **`app`** — Next.js 15。渲染 4 个 surface（`index` / `gate` / `admin` / `login`）。通过 HTTP 跟 backend 说话。
3. **`backend`** — 单个 Go 二进制，同端口暴露 3 个逻辑 API 命名空间（admin / public-v1 / mcp）。DDD 分层（`domain` / `app` / `infra` / `interfaces`）。
4. **`db`** — PostgreSQL 16 + pgvector。
5. **`redis`** — session、队列、限流。

1 个按需服务：

6. **`builder`** — 每次 `microsite.build()` MCP 调用时拉起的沙箱容器，把静态产物写到共享 volume 后退出。

可选 / 后续：

- **`worker`** —— 异步任务（embedding 计算、邮件发送等）独立进程。在用量证明需要之前，先用 backend 内 goroutine + 异步队列搞定。

### 为什么是这个形状

- 三个职责（代理 / web / API）独立伸缩、独立调试。容器多一些，compose 行数多一些，但边界跟我们 debug 和重启的思路对齐。
- backend 作为一个 Go 二进制把 REST + MCP + RAG 统一在一个鉴权面后面。我们不希望 MCP 和 REST 对"什么是 access code"出现分歧。
- builder 跟 backend 隔开，因为 owner 提供的代码不可信。

### 决策点

**A.1** SSR 策略。公开页（`/[handle]`、`/[handle]/gate`）SEO 敏感 → SSR。admin 鉴权后台 → CSR（更简单，bundle 更小）。**推荐：** 混合，公开 SSR，admin CSR。

**A.2** MCP server 放哪。和 backend 同进程（同一个 Go 二进制）vs 独立容器。**推荐：** 同进程 —— 共享鉴权（API token），共享数据层（sqlc 生成的 query），`mcp-go` 能干净地挂到 chi router 上。

**A.3** Builder 生命周期。常驻 build server（旧形态）vs 按构建拉起。**推荐：** 按构建拉起，通过 `docker run`（或 k8s job 等价物），由 MCP 工具调用（`microsite.build`）触发。多数 owner 不常 rebuild；常驻 build server 浪费 RAM 而且多一个攻击面。

**A.4** 异步任务。in-process goroutine + Redis 队列（`asynq` 或 `river`）vs 独立 worker 容器。**推荐：** v1 in-process；embedding 队列堆起来再拆。

---

## B. 技术选型

### 从遗留代码沿用

- **PostgreSQL。** 装 pgvector 扩展。继续用。
- **Next.js 15 + React 19 + Tailwind 4。** 设计稿本身就是 Tailwind，迁移成本极低。
- **TypeScript** 前端 + SDK 全覆盖。

### 从遗留代码丢弃

- **Django + DRF + FastMCP + uv** —— 被下面的 Go 栈替代。`standmeet-server/backend/` 里的 Django 代码只作参考。

### 新引入

#### 后端（Go）

- **Go 1.22+**，标准库 `net/http` + **`chi`** router（轻量、无 magic、中间件约定明确）。
- **`sqlc`** 做数据层。我们写一份 `schema.sql` 和 `queries.sql`，sqlc 生成类型化的 Go 函数。没有运行时 ORM magic；写错 query 是编译错误。
- **`pgx/v5`** 作为底层驱动（sqlc 推荐的 backend，支持 pgvector，配合 `pgx-pgvector`）。
- **`mark3labs/mcp-go`** 做 MCP server（社区主流 Go MCP SDK，支持 streamable HTTP transport）。
- **`goose`** 做 SQL migration —— 朴素的 `*.sql` 文件带 `up`/`down`，启动时跑。
- **`golang.org/x/crypto/argon2`** 做密码 hash（Argon2id）。
- **`redis/go-redis/v9`** 做 session / 队列 / 限流。
- **`anthropic-sdk-go`** + **OpenAI Go SDK** 给 code-tier 推理用（BYOAI 推理永远不经过我们，见 D.2）。

#### 边缘 / 基础设施

- **Caddy 2** 反向代理 + Let's Encrypt 自动签 + 自定义域名 on-demand TLS。
- **pgvector** 存 embedding + ANN 检索。省掉一个外置 vector DB。

#### 前端

- **shadcn/ui**（重度主题化）做 admin 的底层 primitive（Dialog / Combobox / Tooltip / Tabs / Toggle）。公开 surface（`index`、`gate`）手撸 —— 那是品牌脸面。
- **tsup** 打包 SDK。

### SDK 形态

`sdk/` 一个小 monorepo（pnpm workspace），3 个 package：

```
sdk/
├─ packages/
│  ├─ core/    @standmeet/sdk-core   -- API client + types + 状态机（无 UI）
│  ├─ react/   @standmeet/sdk         -- React 组件 + hooks，依赖 core
│  └─ embed/   @standmeet/embed       -- Web Components 包装层，依赖 react
```

产物既发 npm 也由每个 instance 在 `/sdk/v1/...` 下 serve，自部署用户可以让 `<script>` 直接指向自己 instance。

### 为什么是这个形状

- Go 二进制以 `FROM scratch` 镜像（约 20 MB）部署；和 Python 镜像（约 150 MB + uvicorn worker）比，自部署 footprint 缩小 ~7 倍。
- sqlc + DDD 读起来清爽：SQL query 在 `db/queries/*.sql`，生成代码在 `internal/infra/db/`，业务逻辑在 `internal/app/`。没有 ORM 形态的意外。
- Core 拆出来意味着将来要加 Vue / Svelte adapter 时协议层能复用。
- Embed 通过在 Web Component 里渲染 React，多约 40 KB gzip，换得不用维护两套完全独立的 UI 代码。

### 决策点

**B.1** 引入 shadcn/ui。省 a11y primitive 时间，但多一份依赖。**推荐：** 只 admin 用。

**B.2** pgvector vs 外置（Pinecone / Qdrant）。pgvector 对自部署更友好，~1M entry 之内够用。**推荐：** pgvector。

**B.3** SDK 打包：React 优先，embed 通过包装 React 来发 Web Component vs 两套独立代码。**推荐：** React 优先 + embed 包装。

**B.4** `@standmeet/sdk` 同时发 npm 还是只 instance 自带。**推荐：** 都发 —— npm 给跨 instance 引用方便；instance 自带是 admin 的 MCP setup snippet 里 `<script>` 默认源。

**B.5** Migration 工具：`goose`（纯 `*.sql`，轻量） vs `atlas`（HCL/SQL 声明式 + linting）。**推荐：** goose —— owner 部署的简单性比 atlas 那点 schema drift 检测更重要。

**B.6** 异步队列：`asynq`（Redis、简单） vs `river`（Postgres 后端、依赖更少）。**推荐：** 一开始不引队列库 —— 直接 goroutine + Redis list；用量上来再上 `asynq`。

---

## I. 代码目录结构

（放在 C/D/E 之前，因为它决定了 schema / endpoint 落在哪里。）

```
standmeet/
├─ CLAUDE.md
├─ README.md
├─ Makefile
├─ docker-compose.yml          ← prod-ish，install.sh 用
├─ docker-compose.dev.yml      ← dev 用，热更，host 挂载
├─ Caddyfile
├─ .env.example
├─ install.sh                  ← 一行自部署安装脚本
│
├─ backend/                    ← 新 Go server（chi + sqlc + mcp-go），命名对齐 Otium auth
│  ├─ go.mod / go.sum
│  ├─ .golangci.yml            ← 从 Otium auth 抄（v2，default-all + 精挑细选 disable）
│  ├─ .go-arch-lint.yml        ← 强制下面的依赖箭头
│  ├─ Makefile                 ← lint 链：fmt-check / max-lines / routes-cyclo / arch / golangci / escape-lint / secrets
│  ├─ Dockerfile               ← 多 stage build → distroless 静态产物
│  ├─ entrypoint.sh            ← goose up 跑 migration 后启动 server
│  ├─ sqlc.yaml
│  ├─ cmd/
│  │  └─ server/main.go        ← composition root：组装所有依赖、启 HTTP
│  ├─ internal/                ← 按外部系统切 infra（对齐 Otium），不用扁平 infra/
│  │  ├─ domain/               ← 实体、值对象、repository 接口（纯 Go，不 import 任何 internal）
│  │  ├─ usecases/             ← use case（PromoteRawToWiki、IssueCodeSession 等）
│  │  ├─ postgres/             ← sqlc 生成 + Repository 实现（owner_id 由 ctx 强制）
│  │  ├─ storage/              ← media driver（本地 / s3）
│  │  ├─ sandbox/              ← 按构建拉起 builder 的 helper（包装 docker run）
│  │  ├─ inference/            ← anthropic + openai client
│  │  ├─ session/              ← owner session / visitor session / API token / claim
│  │  ├─ middleware/           ← chi middleware（auth.WithOwner 在这里）
│  │  ├─ routes/               ← presentation layer
│  │  │  ├─ admin/             ← /api/admin/* 的 chi 路由（session auth）
│  │  │  ├─ public/            ← /api/v1/* 的 chi 路由（visitor session-token auth，CORS open）
│  │  │  └─ internal/          ← /internal/healthz、tls-ask、log
│  │  ├─ mcp/                  ← mcp-go：tools、prompts、resources
│  │  ├─ config/               ← env loader
│  │  └─ server/               ← chi 路由组装（不做业务）
│  ├─ db/
│  │  ├─ migrations/           ← goose 的 *.sql
│  │  ├─ schema.sql            ← canonical schema（sqlc 输入）
│  │  └─ queries/              ← *.sql，按 aggregate 分文件（raw.sql、wiki.sql、codes.sql、…）
│  ├─ scripts/                 ← check-max-lines.sh / check-routes-cyclo.sh（从 Otium 抄）
│  └─ tests/                   ← 集成测试（testcontainers 起 PG + Redis）
│
├─ app/                        ← 新 Next.js
│  ├─ package.json
│  ├─ Dockerfile
│  ├─ next.config.ts
│  ├─ tailwind.config.ts
│  └─ src/
│     ├─ app/
│     │  ├─ (public)/[handle]/page.tsx           ← surface: index
│     │  ├─ (public)/[handle]/gate/page.tsx      ← surface: gate
│     │  ├─ (auth)/login/page.tsx                ← surface: login
│     │  ├─ (auth)/setup/page.tsx                ← 首次 claim
│     │  └─ (admin)/admin/[[...slug]]/page.tsx   ← surface: admin（SPA 风格）
│     ├─ components/                              ← 共享、主题化
│     ├─ lib/
│     │  ├─ api/                                  ← 类型化的 admin + public client
│     │  ├─ auth/                                 ← session helper
│     │  └─ design/                               ← Newsreader/Mono 配置、色彩 token、动效
│     └─ styles/globals.css
│
├─ sdk/                        ← npm 包
│  ├─ pnpm-workspace.yaml
│  └─ packages/
│     ├─ core/                 ← @standmeet/sdk-core
│     ├─ react/                ← @standmeet/sdk
│     └─ embed/                ← @standmeet/embed
│
├─ builder/                    ← 按构建拉起的沙箱镜像
│  ├─ Dockerfile               ← node + vite + 一个薄 runner
│  ├─ runner.mjs               ← 从 stdin/volume 读源码、写 dist/
│  └─ template/                ← 用 @standmeet/sdk 的起步 App.tsx
│
├─ infra/
│  ├─ caddy/                   ← Caddyfile 片段、tls-ask helper
│  └─ scripts/                 ← install.sh、backup.sh、restore.sh
│
├─ e2e/                        ← Playwright，整 stack 覆盖
│  ├─ package.json
│  ├─ playwright.config.ts
│  └─ tests/
│
├─ docs/
│  ├─ design/                  ← prototype handoff（视觉权威源）+ 本文件
│  └─ <legacy *.md>            ← 旧愿景/蒸馏，保留作参考
│
├─ standmeet-client/           ← legacy 参考（Electron）
├─ standmeet-e2e/              ← legacy 参考（Playwright）
└─ standmeet-server/           ← legacy 参考（旧 Django monorepo）
```

### 决策点

**I.1** 根层是否放 `pnpm-workspace.yaml` 覆盖 `app/` / `sdk/` / `e2e/`，让类型和 lockfile 共享。backend 仍由 Go module 管理，不进 pnpm。**推荐：** 放。

**I.2** `admin` 放路由组（`/admin/*` 同 host）vs 独立 hostname。**推荐：** 路由组 —— owner 只 CNAME 一个域名，admin 就在它的 `/admin` 下。DNS/SSL 面更小。

**I.3** `builder/` 放根目录，不放 `backend/` 下。**推荐：** 根 —— 它是独立 runtime 镜像，有自己的依赖树；放 backend 下会模糊边界。

**I.4** `backend/internal/` 命名形态。三档：(a) 我最初的纯 DDD 命名（`domain/app/infra/interfaces`，infra 子包扁平塞进去）；(b) Go 习惯按 feature 切（`internal/corpus`、`internal/codes`）；(c) **DDD 但按外部系统切 infra**（`domain/usecases/postgres/storage/sandbox/inference/session/middleware/routes/mcp/config/server`，对齐 [[youteacher]] 同 host 的 Otium auth 服务）。**已选：** (c) —— owner 已有的肌肉记忆 + go-idiomatic（每个 infra 子包是单一职责 leaf，名字直接说明它适配哪个外部系统）；`.go-arch-lint.yml` 按这套 component 强制依赖箭头。

---

## C. 数据模型

所有表都有 `owner_id uuid not null` 并带索引。v1 单 owner 时所有行都是同一个值；将来切多租户不需要 migration。

### 租户 / 鉴权

```
owners
  id                   uuid pk
  email                citext unique
  password_hash        text                       -- Argon2id
  handle               citext unique              -- URL slug
  full_name            text
  location             text
  custom_domain        citext unique null
  custom_domain_status text                       -- 'unset' | 'pending' | 'verified'
  byoai_enabled        bool default true
  byoai_providers      jsonb                      -- ['claude','openai']
  byoai_public_blurb   text
  created_at           timestamptz

instance_settings                                  -- 单行（id=1）
  is_claimed           bool default false
  setup_token_hash     text null                  -- 一次性 token，sha256(plaintext)；plaintext 打印到 stdout
  multi_tenant         bool default false
  deployed_at          timestamptz
```

### Corpus

```
raw_entries
  id              uuid pk
  owner_id        uuid fk
  body            text
  source          text                            -- 'mcp:claude-desktop' | 'mcp:cursor' | 'telegram-bot' | 'admin-manual'
  source_meta     jsonb
  tags            text[]
  flagged_private bool default false
  promoted_to     uuid null fk -> wiki_entries
  archived        bool default false
  created_at      timestamptz

wiki_entries
  id                   uuid pk
  owner_id             uuid fk
  title                text
  body                 text
  tags                 text[]
  visibility           text                       -- 'public' | 'on_request' | 'private'
  source_raw_ids       uuid[]
  embedding            vector(1536) null
  embedded_at          timestamptz null
  -- SEO landing 页（默认关，逐条 owner 决定开；详见 J）
  seo_landing_enabled  bool default false
  seo_slug             citext null                -- URL slug；为空时从 title slugify
  seo_title            text null                  -- override <title>；为空 = 用 title
  seo_description      text null                  -- override meta description
  seo_og_image_id      uuid null fk -> media_assets
  created_at           timestamptz
  updated_at           timestamptz

media_assets
  id              uuid pk
  owner_id        uuid fk
  kind            text                            -- 'image' | 'audio' | 'file'
  filename        text
  mime_type       text
  size_bytes      bigint
  storage_key     text                            -- "{owner_id}/{kind}/{uuid}.{ext}"
  raw_entry_id    uuid null fk -> raw_entries
  wiki_entry_id   uuid null fk -> wiki_entries
  created_at      timestamptz
```

### 访问控制

```
access_codes
  id                  uuid pk
  owner_id            uuid fk
  code                citext unique               -- 'LABEL-XXX'
  label               text                        -- 'OAEN'
  purpose             text                        -- 自由文本，仅 owner 可见
  included_tags       text[]
  excluded_tags       text[]
  suggested_questions jsonb                       -- string[]
  expires_at          timestamptz null
  status              text                        -- 'active' | 'revoked' | 'expired'
  created_at          timestamptz

code_members
  id                  uuid pk
  code_id             uuid fk -> access_codes
  display_name        text                        -- 'Alice (HR)'
  email               citext null
  is_anonymous        bool                        -- 以 'someone new' 进入
  last_seen_at        timestamptz null
```

### 访客会话

```
conversations
  id                  uuid pk
  owner_id            uuid fk
  tier                text                        -- 'code' | 'byoai'
  code_id             uuid null fk
  member_id           uuid null fk
  visitor_name        text null
  byoai_provider      text null
  started_at          timestamptz
  last_at             timestamptz
  message_count       integer default 0
  hit_private         bool default false

messages
  id                  uuid pk
  conversation_id     uuid fk
  role                text                        -- 'visitor' | 'assistant'
  body                text
  tool_calls          jsonb null
  cited_wiki_ids      uuid[]
  created_at          timestamptz
```

### 默认页内容

```
page_content                                       -- 每个 owner 一行；支撑默认 index surface
  owner_id            uuid pk fk
  hero_prose          text
  hero_examples       jsonb
  insights            jsonb
  projects            jsonb
  status_block        jsonb
  contact_block       text
  -- per-page SEO override（为空时走 seo_settings 兜底；详见 J）
  seo_title           text null
  seo_description     text null
  seo_og_image_id     uuid null fk -> media_assets
  seo_canonical       text null
  seo_extra_head_html text null                    -- 仅这页要加的 head 注入
  updated_at          timestamptz

seo_settings                                       -- 每个 owner 一行；全 instance SEO 默认值
  owner_id            uuid pk fk
  default_og_image_id uuid null fk -> media_assets -- 没有特定页 og_image 时的兜底
  -- 结构化字段（admin 表单填，server 拼标准 snippet）
  analytics           jsonb                        -- { ga_id?, plausible_domain?, umami_id?, ... }
  verifications       jsonb                        -- { google_search_console?, bing?, ahrefs?, ... }
  -- 万能注入（owner 想塞任何东西）
  extra_head_html     text null
  -- robots / sitemap
  robots_override     text null                    -- 完整 robots.txt override；为空 = server 生成默认
  sitemap_exclude     text[]                       -- 路径白名单内的排除（如 ["/work"]）
  -- Person schema 默认自动生成，owner 可以 override
  person_schema_override jsonb null
  updated_at          timestamptz
```

### 自定义页（MCP 创作，三档发布）

```
microsites
  id                  uuid pk
  owner_id            uuid fk
  slug                text                        -- '' = 根（覆盖默认 index）；'/blog'、'/work'、…
  packages            jsonb                       -- 允许列表内的 npm deps（服务端按 allowlist 校验）
  draft_files         jsonb                       -- {path: contents}；通过 MCP 实时写入的当前状态
  staging_build_id    uuid null fk -> microsite_builds
  live_build_id       uuid null fk -> microsite_builds
  staging_url_token   text null                   -- 不可猜 token；staging URL = host/_stage/{token}/...
  staged_at           timestamptz null
  live_at             timestamptz null
  -- per-page SEO override（同 page_content）
  seo_title           text null
  seo_description     text null
  seo_og_image_id     uuid null fk -> media_assets
  seo_canonical       text null
  seo_extra_head_html text null
  seo_sitemap_include bool default true            -- 是否进 sitemap.xml
  created_at          timestamptz
  unique(owner_id, slug)

microsite_builds                                 -- 不可变 artifact 记录
  id                  uuid pk
  page_id             uuid fk -> microsites
  status              text                        -- 'building' | 'built' | 'failed'
  build_log           text                        -- 截断到 64 KB
  output_path         text null                   -- 'custom/{owner_id}/{build_id}/'
  source_snapshot     jsonb                       -- build 时的 files（rollback / 审计用）
  packages_snapshot   jsonb
  started_at          timestamptz
  finished_at         timestamptz null
  error               text null
```

三档发布状态（`draft` / `staging` / `live`）是派生列：

- **draft** —— 上次 build 之后 `draft_files` 有变动。
- **staging** —— `staging_build_id` 非空，指向状态为 `built` 的 build，在 `/_stage/{staging_url_token}/` 提供服务。
- **live** —— `live_build_id` 非空，在 owner 的公开路径（`/{slug}`）提供服务。

promote = "把选中的 build_id 拷到目标字段"。rollback = "把 `live_build_id` 改回某个之前的 build"。历史永远不删 —— 既是审计也是兜底。

### API token / connector

```
api_tokens                                         -- 对齐 youteacher 的简化做法：无 scope、无 prefix、撤销即硬删
  id              uuid pk
  owner_id        uuid fk
  name            text                             -- 按机器设备命名（"mojat-mbp"、"galaxy-tab"）
  token_hash      text unique                      -- sha256(plaintext)；plaintext 只显示一次
  scopes          text[] default '{*}'             -- v1 全权限；schema 为未来粗/细粒度预留
  last_used_at    timestamptz null
  created_at      timestamptz
  -- 撤销 = DELETE FROM api_tokens WHERE id=...（硬删，不保留 revoked_at）

connectors
  id              uuid pk
  owner_id        uuid fk
  kind            text                            -- 'email' | 'calendar'
  provider        text                            -- 'google' | 'outlook'
  enabled         bool
  oauth_token     bytea null                      -- 落盘加密（AES-GCM，key 从 env 读）
  oauth_refresh   bytea null
  meta            jsonb
```

### 索引（非主键）

- `owners(email)` unique、`owners(handle)` unique、`owners(custom_domain)` unique partial where not null
- `raw_entries(owner_id, created_at desc)`、`raw_entries(owner_id, archived) where archived=false`
- `wiki_entries(owner_id, visibility)`、`wiki_entries USING ivfflat (embedding vector_cosine_ops)`
- `access_codes(code)` unique、`access_codes(owner_id, status)`
- `messages(conversation_id, created_at)`
- `api_tokens(token_hash)` unique
- `microsites(owner_id, slug)` unique
- `microsite_builds(page_id, started_at desc)`
- `wiki_entries(owner_id, seo_slug) where seo_landing_enabled` unique partial — SEO landing 路由

### 决策点

**C.1** Embedding 何时算。写入时同步算 vs 异步队列。**推荐：** 异步 —— `promote_to_wiki` 立即返回；embedding 还没算出来之前 retrieval 走 lexical search 兜底。

**C.2** `page_content` 用 JSONB blob vs 拆关系表。JSONB 跟 admin 整块编辑的语义一致。**推荐：** JSONB；每个 owner 一行；若将来某字段成为检索热点，再单独拆列出来。

**C.3** 媒体存储。本地文件系统（挂 volume） vs S3 兼容。**推荐：** 默认本地 + 可插拔 driver —— `storage_key` 两种都适用；install.sh 设 `STORAGE_DRIVER=local`。

**C.4** 标签体系。自由 `text[]` vs 单独 `tags` 表带 FK。**推荐：** 自由文本；将来 owner 的 tag 散乱了再加 `tag_aliases`。

**C.5** Owner-id 强制层。Go 里没有 Manager 模式；等价做法是把 sqlc 生成的 query 包在 **Repository** 里，每个 method 首个参数是 `ownerID`，永远不暴露裸 query。再加一个自定义 vet 检查（`cmd/lint/owneridvet`）报错任何在 Repository 之外调 sqlc 函数的代码。**推荐：** Repository 模式 + vet check。多租户真做起来时再上 Postgres RLS 做兜底。

**C.6** 自定义页 npm 包 allowlist。沙箱不能让 owner 的 AI 随意 npm install 任意代码。维护一份 allowlist（`react`、`framer-motion`、`lucide-react`、`clsx`、`@standmeet/sdk`、…），server 端在调 builder 前校验。**推荐：** v1 列 ~15 个常用包，按需扩展。

**C.7** Build 留存策略。`microsite_builds` 会越堆越多。**推荐：** 每个 page 保留最近 20 个 + 当前 `live_build_id` 永久保留 + 30 天清理其它。

---

## D. API 设计

3 个独立 API 面。各自鉴权、各自 schema、各自受众。同一个 Go 二进制，不同的 chi sub-router。

### D.1 Admin REST API — `/api/admin/*`

- **受众：** owner 的浏览器（admin Next.js surface）。
- **鉴权：** session cookie + 状态变更请求带 CSRF。
- **CORS：** 同源（admin 跟 public 在同一个 instance 域名上）。

```
GET    /api/admin/me
POST   /api/admin/me/logout

GET    /api/admin/raw                       ?source=&tag=&q=
POST   /api/admin/raw                       -- 手动 dump（admin 的 quick-dump 框）
PATCH  /api/admin/raw/:id
DELETE /api/admin/raw/:id
POST   /api/admin/raw/:id/promote           {title, visibility, tags}

GET    /api/admin/wiki                      ?visibility=&tag=
POST   /api/admin/wiki
PATCH  /api/admin/wiki/:id
DELETE /api/admin/wiki/:id

GET    /api/admin/codes
POST   /api/admin/codes
PATCH  /api/admin/codes/:id
DELETE /api/admin/codes/:id                 -- 撤销（软删）
POST   /api/admin/codes/:id/members
DELETE /api/admin/codes/:id/members/:mid

GET    /api/admin/conversations             ?code_id=&tier=
GET    /api/admin/conversations/:id

GET    /api/admin/page
PUT    /api/admin/page                      -- 原子替换默认页 block

POST   /api/admin/media                     -- multipart upload（admin 手传）
GET    /api/admin/media                     ?attached_to=
DELETE /api/admin/media/:id

GET    /api/admin/tokens
POST   /api/admin/tokens                    -- response 只包含明文一次
DELETE /api/admin/tokens/:id

GET    /api/admin/connectors
POST   /api/admin/connectors/:kind/oauth/start    -> {redirect_url}
GET    /api/admin/connectors/:kind/oauth/callback

# Microsites —— 只做监控 / lifecycle。**不**做源文件 CRUD。
GET    /api/admin/microsites              -- 列表 + 派生状态（draft/staging/live）
GET    /api/admin/microsites/:id
GET    /api/admin/microsites/:id/builds   -- 最近 build 历史
POST   /api/admin/microsites/:id/publish  {build_id}  -- 把某个 built 提升到 live
POST   /api/admin/microsites/:id/rollback              -- 上一个 live_build_id
POST   /api/admin/microsites/:id/unpublish             -- live_build_id := null
DELETE /api/admin/microsites/:id

# SEO（详见 J）
GET    /api/admin/seo                       -- owner-level 默认值（seo_settings 表）
PUT    /api/admin/seo                       -- 改 owner-level
# per-page SEO 通过下面这些 endpoint 一起改：
#   PUT  /api/admin/page          { ..., seo: {...} }      默认页 override
#   PATCH /api/admin/microsites/:id { seo: {...} }       microsite override
#   PATCH /api/admin/wiki/:id     { seo_landing_enabled, seo: {...} }   wiki landing
GET    /api/admin/seo/preview               ?path=/   -- 预览最终 <head>（owner-level + per-page 合并）
```

源文件创作完全走 MCP，不在这里（见 D.3）。

### D.2 Public API — `/api/v1/*`

- **受众：** SDK 客户端（instance 自己的 Next.js 公开页 + 任何第三方站点 embed SDK）。
- **鉴权：** `POST /api/v1/sessions` 颁发的 Bearer session token。不透明、Redis-backed，TTL 60 分钟，滑动续期最多 8 小时。
- **CORS：** 读 endpoint 完全开放；写 endpoint 受限（目前只有 sessions）。

```
POST   /api/v1/sessions
  body: {
    handle: 'sijie',
    code?: 'LABEL-XXX',
    member_id?: uuid,
    visitor_name?: string,
    byoai?: { provider: 'claude'|'openai' }
  }
  returns: {
    session_token, expires_at,
    scope: { included_tags, excluded_tags, visibility_max },
    suggested_questions, owner_handle, owner_display
  }

POST   /api/v1/sessions/:id/messages
  body: { content }
  response: text/event-stream
  events: token delta、tool_call_start、tool_call_end、citation、done、error

GET    /api/v1/page/:handle                -- 默认页内容（只读，含 seo meta）
GET    /api/v1/page/:handle/byoai-config   -- {enabled, providers, public_blurb}
GET    /api/v1/sdk/v1/manifest             -- SDK build 元信息（给 instance 自带的 <script> 用）

# SEO 公开 endpoint（爬虫直接访问；详见 J）
GET    /robots.txt                         -- backend 动态生成；owner 可 override
GET    /sitemap.xml                        -- 列默认页 + 所有 live microsites + 所有 seo_landing_enabled 的 wiki
GET    /api/v1/wiki/:handle/:seo_slug      -- public wiki entry 的可索引内容（仅 seo_landing_enabled 的可访问）
GET    /api/v1/og/page/:handle             -- 自动渲染默认页 OG image (PNG)
GET    /api/v1/og/custom/:page_id          -- 自动渲染 microsite OG image
GET    /api/v1/og/wiki/:wiki_id            -- 自动渲染 wiki landing OG image
```

### D.3 MCP server — `/mcp/`

- **受众：** owner 的 AI 客户端（Claude Desktop、Cursor、…）。
- **鉴权：** `Authorization: Bearer smk_…`。
- **协议：** `mcp-go` 的 streamable HTTP transport。

**工具 —— corpus（ingest）：**

```
raw_dump(body, tags?, source_label?, attach_media_id?)
  -> {raw_id}

promote_to_wiki(raw_id, title, visibility, tags?)
  -> {wiki_id}

upload_media(base64, mime, attached_to?: {kind, id})
  -> {media_id, storage_key}

set_tags(entry_kind, entry_id, tags)
add_tags(entry_kind, entry_id, tags)
remove_tags(entry_kind, entry_id, tags)

list_recent(kind, limit=20, since?)
search_wiki(query, limit=10, visibility_filter?)
get_wiki(wiki_id)

archive(entry_kind, entry_id)
```

**工具 —— microsites（整套创作面就这套工具）：**

```
# 生命周期
microsite.list()
  -> [{id, slug, has_draft, staging_url?, live_url?, last_build}]
microsite.create(slug, template?='blank')
  -> {page_id}
microsite.delete(page_id)

# 文件编辑 —— AI 通过这几个工具写 React 源码
microsite.list_files(page_id)
  -> [{path, size}]
microsite.read_file(page_id, path)
  -> {contents}
microsite.write_file(page_id, path, contents)
microsite.delete_file(page_id, path)
microsite.set_packages(page_id, deps)
  -- deps 走 server 端 allowlist 校验（见 C.6）

# Build 与发布
microsite.build(page_id)
  -> {build_id}                                     -- 异步；拉起 builder 容器
microsite.get_build(page_id, build_id?)
  -> {status, log, finished_at, error?}             -- build_id 省略 = 最新
microsite.promote_to_staging(page_id, build_id?)
  -> {staging_url}                                  -- 不可猜 token 的 URL
microsite.promote_to_live(page_id, build_id?)
  -> {live_url}
microsite.rollback(page_id)
  -- live_build_id := 上一个 live build
```

**工具 —— SEO（详见 J）：**

```
# owner-level（全 instance）
seo.get_owner()
  -> {analytics, verifications, extra_head_html, robots_override, default_og_image_id, person_schema_override}
seo.set_owner(patch)                                -- 部分更新

# per-page override
seo.set_default_page(patch)                         -- 默认页 SEO override
seo.set_microsite(page_id, patch)                 -- microsite SEO override
seo.set_wiki(wiki_id, {
  landing_enabled?: bool,
  slug?: string,
  title?, description?, og_image_id?
})

# 预览
seo.preview(path)
  -> {final_head_html, computed_title, computed_description, og_image_url}
```

AI 可以在写 microsite 时一并调 `seo.set_microsite(page_id, {title: ..., description: ...})`，不需要 owner 跳出去手动配。

Owner 的典型流程：

> Owner（在 Claude Desktop）："给我加个 `/blog` 页，从我 wiki 里 visibility=public 的最近 5 篇拉内容做 hero。"
> AI：调 `microsite.create('/blog')` → `search_wiki(visibility='public', limit=5)` → 几次 `write_file()` → `build()` → 轮询 `get_build()` 直到 built → `promote_to_staging()` → 把 staging URL 念回来。
> Owner：浏览器打开看，"hero 字太小，再大一倍。"
> AI：`write_file()` + `build()` + 新 staging URL。
> Owner："上线。"
> AI：`promote_to_live('/blog')`。

admin 的 "Microsites" 区是上面所有动作的监控面板 —— 页列表、派生状态、staging/live URL、`publish` / `rollback` / `unpublish` / `delete` 手动按钮。**不**做编辑器、不嵌聊天、不放预览 iframe。

### D.4 内部 endpoint — `/internal/*`

- `/internal/healthz` —— Caddy 探活 + uptime。
- `/internal/tls-ask?domain=…` —— Caddy on-demand TLS 的把关接口。当且仅当 domain 匹配某个 owner 的 `custom_domain_status='verified'` 时返回 200。
- `/internal/log` —— 前端错误上报（限流）。

### 决策点

**D.1** chat 流走 SSE vs WebSocket。SSE 是 HTTP，CORS / proxy / 浏览器全友好；丢的是双向通讯，我们不需要。**推荐：** SSE。

**D.2** BYOAI 的 key 路径。访客的 API key 永远不应到我们 server。流程：server 返回 RAG context + 过滤后的 scope；SDK 用访客的 key 直接调 `api.anthropic.com` / `api.openai.com`。server proxy 方案更简单，但承担访客 key 的存储责任。**推荐：** 客户端直连，两步（RAG → infer）。

**D.3** MCP 鉴权 —— 现在 API token，后面 OAuth。owner 在 admin 建 token，把 JSON snippet 粘到 Claude Desktop。有点摩擦但 v0 稳。**推荐：** v1 API token；v2 等 MCP OAuth 公约稳定再加。

**D.4** session token 存储。server 端不透明 Redis（可即时撤销） vs JWT（无状态，撤销要 deny-list）。owner 撤 code 时要立刻生效。**推荐：** 不透明 + Redis。

**D.5** `raw_dump` 的幂等。AI 在临时失败时可能重试导致重复写。**推荐：** MCP 写工具要求带 `request_id`（uuid）header，server 在 1 小时窗口内去重。

**D.6** 自定义页写入幂等。`write_file` 天然幂等（内容覆盖）。`build` 有点微妙 —— 同一 page 并发的 build 应该 coalesce（直接返回正在跑的 `build_id`）而不是排队。**推荐：** coalesce；同一 page 最多一个 in-flight build。

---

## E. 鉴权

5 种鉴权场景：

| 场景 | 入口 | 机制 |
|---|---|---|
| 首次 claim instance | `/setup?t=<token>` | 一次性 `setup_token`，打印到 console |
| Owner 登录 | `/login` | 邮箱 + 密码 → session cookie |
| MCP 客户端 | `/mcp/*` | `Authorization: Bearer smk_…`（API token） |
| 访客 code 访问 | `/api/v1/sessions` | code → 不透明 session token |
| 访客 BYOAI 访问 | `/api/v1/sessions` | `byoai: true` → 不透明 session token（仅 public scope） |

### 首次 claim 流程

1. 容器启动。`instance_settings.is_claimed=false`。Backend 生成一次性 `setup_token`，把 `sha256(token)` 存进 `instance_settings.setup_token_hash`，把明文打印到 stdout：
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │ STANDMEET 已就绪。点这个链接 claim：                            │
   │   https://your-domain.example/setup?t=eyJh…                 │
   └─────────────────────────────────────────────────────────────┘
   ```
   同时把 URL 写到 `/srv/first-run.txt`（claim 后自动删），照顾不盯 log 的用户。
2. Owner 打开链接 → setup 页 → 填邮箱/密码/handle/姓名 → `POST /api/admin/claim {token, …}`。
3. Backend 校验 token，创建 owner，标记 `is_claimed=true`，清掉 `setup_token_hash` 和文件。这个 endpoint 之后拒绝调用。
4. Owner 自动登录。

### Owner-id 的传播

- chi 中间件 `auth.WithOwner` 在每个鉴权路由上早早跑一遍。读 session cookie / bearer token / visitor session token（看走哪条），解出 `owner_id`，用类型化 key 放到 `context.Context`。
- Repository 的 method 首参 `ctx context.Context`；method 内部从 context 拿 `owner_id`，没有就 panic（dev 模式下）/ 拒绝执行。
- 自定义 vet 检查（`cmd/lint/owneridvet`）报错任何在 Repository method 之外调 sqlc 函数的代码，防止我们绕开过滤。

### Session 细节

- Owner cookie 名 `smt_session`，HttpOnly、Secure、SameSite=Lax、Path=/api/admin。
- Redis-backed：`session:{token}` → `{owner_id, expires_at, csrf_token}`。
- CSRF：double-submit cookie 模式；前端在 bootstrap 时通过 `GET /api/admin/csrf` 拿。

### 访客 session token

- 32 字节随机 + base64url，前缀 `smv_`。
- Redis：`vsession:{token}` → `{owner_id, code_id?, member_id?, scope, byoai?, expires_at}`。
- TTL 60 分钟，每次请求滑动续期，最多 8 小时。

### API token

设计原则参考 [[youteacher]]：极简，owner 信任自己给自己 AI 配的 token。

- 明文格式 `smk_<24-char-base32>`。Backend 只存 `sha256(plaintext)`。
- 在 admin 里创建；只有创建那一刻看到明文。
- `name` 按机器设备命名（"mojat-mbp"、"galaxy-tab"），admin 表单的 placeholder 提示这样填。
- 撤销 = `DELETE FROM api_tokens WHERE id=...`（硬删），中间件下次校验失败立即 401。
- v1 不做 scope —— 任何持有 token 的 AI 客户端能调所有 MCP 工具。`scopes` 列为 `'{*}'` 占位，方便未来需要分级（IM bridge / 公共中介 token）时再启用。
- 列表 endpoint 只返回元数据（`id` / `name` / `created_at` / `last_used_at`），永远不返回 hash 或明文。

### 决策点

**E.1** Setup token 怎么交付。console print + host file。**推荐：** 都做。

**E.2** 密码 hash。`golang.org/x/crypto/argon2` 的 Argon2id。**推荐：** Argon2id，默认参数 `time=3, memory=64 MB, threads=4`。

**E.3** CSRF 模式。double-submit cookie + admin 状态变更请求带 `X-CSRFToken` header。**推荐：** 标准做法，bootstrap 时走 `/api/admin/csrf`。

**E.4** API token scope 粒度。v1 不做（`scopes='{*}'` 占位，任何 token 全权限）；schema 保留列，未来引入不可信 client（IM bridge 公共 bot、第三方中介）时启用粗粒度三段（`mcp:read` / `mcp:write` / `mcp:pages`）。**已选：** v1 不做（对齐 [[youteacher]] 同类设计）。

**E.5** Admin 跨 origin。**推荐：** v1 不允许；admin 在 public 同 host 的 `/admin`。

---

## F. 多租户预留

形状：v1 各处都按单 owner 接线，但**数据**和 **URL** 已经是多租户形状。

### 数据层

- 每个 domain 表都有 `owner_id`。
- Repository method 从 `context.Context` 取 `ownerID`；没有任何 method 暴露"所有 owner"视图。
- 存储 path 前缀 `{owner_id}/…`。
- Builder 输出 path 前缀 `custom/{owner_id}/{build_id}/…`。

### URL 层（v1 vs v2）

| Surface | v1（单 owner） | v2（多租户） |
|---|---|---|
| 公开 chat | `/` → 中间件改写到 `/{owner_handle}` | `/{handle}` |
| Gate | `/gate` → `/{handle}/gate` | `/{handle}/gate` |
| Admin | `/admin`（要求 owner 登录） | `/admin`（owner 登录 + 自动 scope） |
| Login | `/login` | `/login` |
| Setup | `/setup?t=` | 换成 `/signup` |
| 自定义页 | `/{slug}` → `/{owner_handle}/{slug}` | `/{handle}/{slug}` |
| Staging 自定义页 | `/_stage/{token}/...`（token 内含 owner_id） | 不变 |

v1 中间件把 `/` 折叠到唯一 owner 的 `/{owner_handle}`；v2 卸掉这个中间件、直接 serve `/[handle]`。切换时改动量极小。

### 开关

`instance_settings.multi_tenant: bool`。控制：
- 首次 claim 之后 `/setup` 是否还能访问
- `/signup` 是否启用
- `POST /api/admin/claim` 是否接受新 owner

### 决策点

**F.1** v2 域名策略：`/{handle}` 路径 vs `{handle}.domain` 子域。子域更"个人页"，但要 wildcard SSL + DNS。**推荐：** 两种都规划；v1 走 path；v2 用 `multi_tenant_url_style ∈ {path, subdomain}` 控制。

**F.2** 自定义域名归属。多租户时同一个 instance 服务多个自定义域名。Caddy on-demand TLS 调 `/internal/tls-ask?domain=…`。**推荐：** 数据模型已覆盖。

**F.3** 存储隔离。本地文件系统按 `{owner_id}/…` 路径是软隔离。**推荐：** v1 接受软隔离；记一笔 v2 任务：按 owner UID + quota 硬化。

---

## G. 部署 / 运行时

### docker compose

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
      - microsites:/srv/custom:ro
    environment:
      - STANDMEET_DOMAIN
      - STANDMEET_EMAIL
    depends_on: [app, backend]

  app:
    build: ./app
    restart: unless-stopped
    environment:
      - BACKEND_URL=http://backend:8000
      - NEXT_PUBLIC_INSTANCE_DOMAIN=${STANDMEET_DOMAIN}
    expose: ["3000"]
    depends_on: [backend]

  backend:
    build: ./backend
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgres://standmeet:${DB_PASSWORD}@db:5432/standmeet
      - REDIS_URL=redis://redis:6379/0
      - SESSION_KEY                              # cookie 签名
      - STORAGE_DRIVER=local
      - STORAGE_ROOT=/srv/media
      - BUILDER_IMAGE=standmeet/builder:latest
      - DOCKER_HOST=unix:///var/run/docker.sock  # 让 backend 拉 builder
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - media:/srv/media
      - microsites:/srv/custom
    expose: ["8000"]
    depends_on: [db, redis]

  db:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      - POSTGRES_DB=standmeet
      - POSTGRES_USER=standmeet
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data

volumes:
  caddy_data: {}
  caddy_config: {}
  pgdata: {}
  redisdata: {}
  media: {}
  microsites: {}
```

`builder` 服务**不**在 compose 里 —— backend 通过 Docker socket 在每次 `microsite.build()` 时拉起。

### Backend Dockerfile（多 stage）

```dockerfile
FROM golang:1.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/standmeet ./cmd/server

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/standmeet /standmeet
COPY db/migrations /migrations
USER nonroot:nonroot
ENTRYPOINT ["/standmeet"]
```

启动时跑 `goose up`，从 `/migrations` 读。最终镜像 ~25 MB，无 shell、无 package manager、以 nonroot 跑。

### Caddyfile（草稿）

```
{
  email {$STANDMEET_EMAIL}
  on_demand_tls {
    ask http://backend:8000/internal/tls-ask
  }
}

{$STANDMEET_DOMAIN} {
  handle_path /api/*       { reverse_proxy backend:8000 }
  handle_path /mcp/*       { reverse_proxy backend:8000 }
  handle_path /internal/*  { reverse_proxy backend:8000 }
  handle_path /custom/*    { root * /srv/custom; file_server }
  handle_path /_stage/*    { reverse_proxy backend:8000 }   # staging 由 backend 按 token serve
  reverse_proxy app:3000
}

:443 {
  tls { on_demand }
  @custom not host {$STANDMEET_DOMAIN}
  reverse_proxy @custom app:3000
}
```

### 安装脚本 `install.sh`

```sh
#!/bin/sh
# 1. 检查 docker 和 docker compose
# 2. clone repo 或下载 release tarball
# 3. 询问 STANDMEET_DOMAIN、STANDMEET_EMAIL
# 4. 生成带随机 SESSION_KEY + DB_PASSWORD 的 .env
# 5. docker compose pull && docker compose up -d
# 6. tail backend 日志直到 "STANDMEET 已就绪" 横幅，打印 setup URL
```

### Migration

Backend entrypoint 启动 HTTP server 之前先跑 `goose up`。破坏性 migration 在 release notes 里标红；大版本号变化写到 `MIGRATION.md`。

### 备份 / 恢复

- `make backup` → `pg_dump` + tar `media/` + `microsites/` → 一个带日期的 tarball。
- `make restore TARBALL=…` → 倒进干净的 volume。
- v1：没有自动调度；文档里给 cron one-liner。

### 决策点

**G.1** on-demand TLS 限流（通过 ask endpoint）。**推荐：** ask endpoint 检查 `custom_domain_status='verified'`。

**G.2** 零宕机升级。**推荐：** v1 不做；接受 `docker compose up` 时 5–10 秒宕机。

**G.3** Migration 跑法。启动自动 `goose up` vs 显式 `make migrate` (not built yet — 这是被否掉的那一半)。**推荐：** 自动 + 一个 `MIGRATE_ON_START=false` 的逃生口。

**G.4** Builder 隔离强度。`docker run --rm` + `--network=none` + drop-capabilities + 只读 root + tmpfs `/tmp` + seccomp profile + 内存/CPU 限制 + 60s timeout。再硬就是 gVisor / Firecracker。**推荐：** v1 docker run + 上述硬化；文档里写好升级到 gVisor 的路径。

**G.5** Backend 容器需要 Docker socket 才能拉 builder。这是个权限升级风险（backend 被打穿就完了）。备选方案：rootless Podman，或跑一个 thin `builder-broker` daemon。**推荐：** v1 socket 直接给（反正 backend 本来就是信任边界）；v2 评估 `builder-broker`。

---

## H. 可观测性 / 错误处理

### 日志

- **Backend：** `slog` 输出 JSON 结构化日志到 stdout。字段：`ts, level, owner_id?, request_id, route, msg`。
- **Frontend：** 错误上报 `/internal/log`（限流）。
- **Caddy：** JSON access log。
- **Builder：** stdout 抓到 `microsite_builds.build_log`；owner 通过 `microsite.get_build()` MCP 工具或 admin 列表查看。

### 健康检查

- `GET /internal/healthz` —— PG + Redis 可达就返回 200。
- Caddy 路由前先等这个。

### 用户能看到的错误（沿用 CLAUDE.md 的原则）

标准 envelope：

```json
{ "error": { "code": "tier_insufficient", "message": "...", "hint": "..." } }
```

前端有个统一的 `friendlyError(code)` helper，把 code 映射到能展示的文案。兜底 `"Something went wrong"` —— 绝不暴露 stack trace、退出码、Go panic 字符串。

| code | 含义 | UI 展示 |
|---|---|---|
| `code_invalid` | access code 错误或已撤销 | "这个 code 不对。再检查一下，或者请求 access。" |
| `code_expired` | access code 过期 | "code 过期了。请 owner 再发一个。" |
| `tier_insufficient` | public/byoai tier 触碰到 private | inline "只能看 public，要进一步聊得拿 code" 块 |
| `byoai_disabled` | owner 关了 BYOAI | "owner 没开 BYOAI。用 access code 进吧。" |
| `ratelimited` | 请求太频繁 | "慢一点 —— 一分钟后再试。" |
| `not_found` | handle 不存在 / 404 | 标准 404 页 |
| `build_failed` | 沙箱 build 失败（自定义页） | admin 里展示截断后的 log |
| `package_not_allowed` | 自定义页用了 allowlist 之外的 npm 包 | admin 里展示哪个包 + 怎么申请 |
| `server_error` | 兜底 | "出问题了。"（带 request_id 给排查） |

### Metrics

- v1：结构化日志，临时查。
- v2：`/internal/metrics` 暴露 Prometheus exporter，basic-auth。

### 决策点

**H.1** 匿名 telemetry。**推荐：** v1 不做；自部署用户敏感。

**H.2** 前端 error reporter。**推荐：** 自托管；v2 让 Sentry DSN 可配置。

**H.3** Request ID 传播。Caddy 生成 → `X-Request-ID` 转给 backend → 错误 envelope 里回带。**推荐：** 做。

**H.4** Build log 大小上限。**推荐：** 64 KB 截断 + `(truncated)` 标记。

---

## J. SEO（owner 完全可控）

StandMeet 的页是对外门面，SEO 必须由 owner 完全控制。这章把 C/D 里散落的 SEO 字段集中讨论，并定 og image、sitemap、robots 这几样动态产物的实现策略。

### 两层模型

```
owner-level（seo_settings 表）          ← 默认值（GA、Search Console、Person schema、默认 og）
        │
        ▼
per-page override                     ← 默认页 / 每个 microsite / 每条 seo_landing_enabled wiki
        │
        ▼
最终 <head>                            ← server 合并、SSR 渲染
```

- **owner-level（`seo_settings`）** 一次配，全 instance 共用：GA tracking ID、Search Console 验证、Person schema override、默认 OG 图、`extra_head_html`（万能注入）、`robots_override`、`sitemap_exclude`。
- **per-page override** 在 `page_content` / `microsites` / `wiki_entries` 里：`seo_title` / `seo_description` / `seo_og_image_id` / `seo_canonical` / `seo_extra_head_html`，空则继承 owner-level。
- **合并规则** 简单优先级：per-page 非空 → 用 per-page；否则用 owner-level；都空用 server 派生默认。

### Wiki SEO landing 页

- 默认 `seo_landing_enabled=false`，wiki 只作 RAG 材料，访客看不到独立 URL。
- Owner 觉得某条 wiki 值得独立暴露（长文、有 SEO 价值），点亮开关或叫 AI 调 `seo.set_wiki(id, {landing_enabled: true})`。
- 启用后：`GET /api/v1/wiki/:handle/:seo_slug` 返回完整 wiki body 的渲染页 + "Ask sijie about this" 按钮（跳进 chat 上下文已经预填该 wiki）。
- 自动进 `sitemap.xml`。
- `seo_slug` 必须 owner-internal unique（索引已加）；空时从 title slugify。

### `<head>` 内容的两种填法

按用户答复，两条路都给：

1. **结构化字段**（admin 表单 + MCP `seo.set_owner`）：`analytics: {ga_id, plausible_domain, umami_id}` / `verifications: {google_search_console_token, bing_token}` / `default_og_image_id` / `person_schema_override`。Server 拼出标准 snippet（GA snippet、search-console meta tag 等）。最安全、零代码。
2. **万能注入** `extra_head_html`：owner / AI 直接贴任何 HTML（GA gtag、第三方 SEO tool、Hotjar、…）。是 owner 自己的 instance，不做 sanitization，自担风险。

二者**叠加**输出：先 server 拼的结构化 snippet，再 owner 注入的 `extra_head_html`。owner-level 和 per-page 都各有自己的 `extra_head_html`，按上下文合并。

### sitemap.xml

backend 动态生成，缓存 5 分钟。包含：

- 默认页 `/{handle}` （或 v1 的 `/`）
- 所有 `live` 状态的 `microsites.slug`，除非该 page 的 `seo_sitemap_include=false`
- 所有 `seo_landing_enabled=true` 的 wiki entries
- `seo_settings.sitemap_exclude` 里的路径剔除

每条带 `<lastmod>` 用 `updated_at`、`<changefreq>` 默认 `monthly`、`<priority>` 默认 0.5（microsites 0.8）。

### robots.txt

backend 动态生成。默认：

```
User-agent: *
Disallow: /api/
Disallow: /admin/
Disallow: /login
Disallow: /setup
Disallow: /gate
Disallow: /_stage/
Disallow: /internal/
Sitemap: https://{instance_host}/sitemap.xml
```

`seo_settings.robots_override` 非空就用 override（owner 完全替换默认）。

### OG image 自动生成

每个公开页都需要一张 1200×630 的社交分享卡片。三种策略：

1. **next/og（Vercel 的 SVG → PNG 渲染器）** 在 `app/` 下 `/api/og/*` route 渲染。React JSX 写卡片设计，satori 转 SVG，resvg 转 PNG，sharp 输出。代码和设计 stack 一致。
2. **Go 渲染**：backend 用 `golang.org/x/image/font` 或 `fogleman/gg` 画。性能好但 layout 写起来痛苦。
3. **owner 上传**：上传一个 PNG 当默认；不要自动渲染。

**推荐：1 + 3 并存**：`og_image_id` 为空时走 next/og 自动渲染（含 owner.full + handle + 一行 tagline + 配色取自当前 token），owner 想精控就上传图。app 的 og endpoint 走 `/api/v1/og/*`，背后是 app 服务，缓存 30 天。

### Person schema (JSON-LD)

server 自动从 owner profile 拼一份：

```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Sijie Wang",
  "url": "https://sijie.example",
  "address": { "@type": "PostalAddress", "addressLocality": "Markham, Ontario" },
  "knowsAbout": [...来自 wiki tags 频次 top 5...],
  "sameAs": [...future: 链接到 GitHub / LinkedIn / Twitter 等 connector...]
}
```

`seo_settings.person_schema_override` 非空就用 owner 提供的 JSON 完全替换。

### admin SEO 面板（设计稿里没画，但要补）

设计里 admin 有 `page` section 编辑默认页内容。SEO 面板独立一块（在 admin 左 nav 加 "seo"，或塞进 page section 的折叠区）：

- **Global SEO** —— GA / Plausible / Search Console 表单 + 默认 OG image 上传 + Person schema override（高级折叠）+ robots.txt override（高级折叠）+ extra_head_html
- **Per-page tabs** —— 默认页 / microsites 列表 / wiki SEO 列表，各自简表单（title / description / og_image / canonical / extra_head）
- **预览** —— 输入一个 path，admin 显示最终拼出来的 `<head>` 是什么样（调 `seo.preview` endpoint）

### 决策点

**J.1** OG image 渲染：next/og（Node 在 app 容器渲染）vs Go（在 backend 渲染）。**推荐：** next/og。和设计 stack 一致，layout 用 JSX 写。

**J.2** Sitemap 缓存：每次请求重算 vs 5 分钟内存缓存 vs Redis 缓存。**推荐：** 5 分钟内存（owner update 之后下次爬虫请求最多 5 分钟看到旧版，可接受）。

**J.3** Wiki landing 页的"Ask sijie about this" CTA：进 chat 时 pre-fill 一个问题（"tell me more about: {wiki.title}"），还是把 wiki body 直接当上下文塞进 conversation？**推荐：** pre-fill 问题（保持 chat surface 一致；不污染对话上下文）。

**J.4** `extra_head_html` 是否做 sanitization。Owner 自己的 instance、自担风险 → 不做。但 v2 多租户时 owner A 不能让 owner B 的页执行自己的 JS。**推荐：** v1 不 sanitize；v2 多租户开启时切到允许列表（只放 `<meta>` `<link>` `<script>` 含特定 src host 等）。

**J.5** Wiki landing 是否影响 chat 的 retrieval scope。如果 wiki `seo_landing_enabled=true` 但 `visibility='private'`，会出现一个对外可索引但 chat 时拒绝引用的怪情况。**推荐：** 强制 `seo_landing_enabled=true` 要求 `visibility='public'`，server 端校验。

**J.6** Canonical URL 默认值。custom domain 设置后，canonical 应该指 custom domain 还是 instance domain？影响主搜索引擎对哪个 URL 当主版本。**推荐：** custom domain 一旦 verified，所有 canonical 自动指 custom domain；owner 可 per-page override。

---

## 横切原则

1. **owner_id 不可妥协。** 每张领域表、每个 query、每个存储 path 都要带。Repository 从 `ctx` 取；vet check 兜底。
2. **三个 API 面、三套鉴权、一个进程。** 不要"为了方便"把 admin 和 public endpoint 合到一起。
3. **SDK 是 public API 的一等消费者。** 如果某件事 SDK 难以表达，那是 API 设计错了。
4. **MCP 是 owner 的创作通道，不只是 ingest 通道。** 任何 owner-side 工作流，只要 AI 介入有价值（raw → wiki、写自定义页、打 tag、未来的 ghostwriting、replying），都做成工具集，不要做成 admin UI feature。admin UI 只负责监控和安全的明确控制（publish、rollback、revoke）。
5. **自部署友好 > 功能多。** 任何需要外部 SaaS 账户的东西都是 v2 的事。
6. **错误就是 UI 文案。** Backend code 稳定；前端字符串本地化；永远不要泄漏内部细节。
7. **SEO 是 owner 的写作面，不是 server 的默认行为。** owner 必须能控 `<title>` / meta description / og / `<head>` 注入 / robots / sitemap / 结构化数据。server 提供合理默认，但全部可被 owner 在 admin 表单或通过 MCP 工具 override。

---

## 本文档不解决的开放问题

这些是已知的未知，留给后续单独决定：

- **Code-tier 对话的推理成本谁出** —— owner 配自己的 Anthropic/OpenAI key？存 `connector` 还是 env var？schema 两种都能容；admin 那块 UX 还没设计。
- **IM bridge（Telegram/Discord/Slack）** —— 第一刀不切。数据模型已经容纳（`raw_entries.source='telegram-bot'`；通过 bot DM 走 access code 的访客 session）。
- **Electron 客户端** —— 同上。Ingest channel 已支持；UX 不在本文范围。
- **Connectors（Email / Calendar）** —— schema 在；chat 里 tool call 渲染（`tool_calls jsonb`）支持日历 slot 提议；完整 OAuth 流程待设计。
- **自定义页 allowlist 治理** —— 谁来决定 allowlist、owner 怎么申请加新包、allowlist 本身是不是一个版本化的配置文件。

---

*代码架构草稿到此结束。决策点反馈格式：`A.1: accept` 或 `B.1: change — 不用 shadcn，手撸所有 primitive`。*
