# StandMeet code architecture

> **Status:** Draft, awaiting owner review (revised 2026-05-16; backend switched to Go, builder changed to an MCP-driven workflow).
> **Audience:** the people who will actually write this system. It assumes you have read `CLAUDE.md` for product context and `docs/design/chats/chat1.md` for visual intent.
> **How to give feedback:** each section ends with numbered decision points (`A.1`, `A.2`, …). Reply `Aₙ: accept` or `Aₙ: change — <reason / new direction>`. Anything not mentioned counts as accept.

---

## TL;DR — the shape of the whole system

```
                ┌─── 80 / 443 ───┐
                │     Caddy      │  ← automatic Let's Encrypt + on-demand TLS for custom domains
                └────┬───────────┘
        ┌────────────┼─────────────────────┐
        │            │                     │
   ┌────▼────┐  ┌────▼─────┐         ┌─────▼──────┐
   │   app   │  │ backend  │         │  /custom   │
   │ Next.js │  │   Go     │         │  static    │
   │ :3000   │  │  +chi    │         │  output    │
   └─────────┘  │ +mcp-go  │         │  (volume)  │
                │  :8000   │         └────────────┘
                └────┬─────┘
            ┌────────┼─────────┐
       ┌────▼──┐ ┌───▼────┐ ┌──▼──────────┐
       │  PG   │ │ Redis  │ │  Builder    │
       │ pgvec │ │        │ │  sandbox    │
       └───────┘ └────────┘ │ (per build) │
                            └─────────────┘
```

5 long-running containers (caddy / app / backend / pg / redis) + 1 on-demand container (builder), which the backend starts when the owner's AI client calls an MCP tool. A single docker compose. Self-hosted; one command brings the service up.

### A note on the builder

`microsites` (each owner can have several slugs) are **authored entirely through MCP tools called from the owner's own AI client** (Claude Desktop, Cursor and the like). The "Microsites" section in admin is only a **monitoring panel** — list, status, staging URL, publish/rollback — it does **not** host an editor, a chat box or a preview frame. AI inference is paid for by the owner's existing AI subscription; the StandMeet backend only pays for sandbox builds.

---

## A. System topology

### Constraints

- One command brings up the whole stack (`docker compose up -d`).
- Automatic SSL for both the instance's own domain and the owner's custom domain.
- v1 is single-owner; the data layer is reserved for multi-tenancy.
- The SDK runs in third-party browsers — the API must be CORS-friendly.
- The MCP server must be reachable over HTTPS from the owner's AI client.
- The page builder sandbox runs owner-supplied code and must be isolated.

### Recommended shape

5 long-running services:

1. **`caddy`** — reverse proxy, TLS termination, on-demand TLS for custom domains.
2. **`app`** — Next.js 15. Renders the 4 surfaces (`index` / `gate` / `admin` / `login`). Talks to the backend over HTTP.
3. **`backend`** — a single Go binary that exposes 3 logical API namespaces (admin / public-v1 / mcp) on the same port. DDD layering (`domain` / `app` / `infra` / `interfaces`).
4. **`db`** — PostgreSQL 16 + pgvector.
5. **`redis`** — sessions, queues, rate limiting.

1 on-demand service:

6. **`builder`** — a sandbox container started on each `microsite.build()` MCP call; it writes the static output to a shared volume and exits.

Optional / later:

- **`worker`** — a separate process for async jobs (embedding computation, sending email, etc.). Until usage proves it is needed, handle these with goroutines + an async queue inside the backend.

### Why this shape

- The three responsibilities (proxy / web / API) scale independently and are debugged independently. More containers and more compose lines, but the boundaries match how we debug and restart.
- The backend, as one Go binary, puts REST + MCP + RAG behind a single auth surface. We do not want MCP and REST to disagree on "what an access code is".
- The builder is kept apart from the backend because owner-supplied code is untrusted.

### Decision points

**A.1** SSR strategy. Public pages (`/[handle]`, `/[handle]/gate`) are SEO-sensitive → SSR. The authenticated admin backend → CSR (simpler, smaller bundle). **Recommended:** hybrid — public SSR, admin CSR.

**A.2** Where the MCP server lives. In the same process as the backend (the same Go binary) vs a separate container. **Recommended:** same process — shared auth (API token), shared data layer (sqlc-generated queries), and `mcp-go` mounts cleanly on the chi router.

**A.3** Builder lifecycle. A long-running build server (the old shape) vs started per build. **Recommended:** started per build, via `docker run` (or a k8s job equivalent), triggered by an MCP tool call (`microsite.build`). Most owners rarely rebuild; a long-running build server wastes RAM and adds an attack surface.

**A.4** Async jobs. In-process goroutines + a Redis queue (`asynq` or `river`) vs a separate worker container. **Recommended:** in-process for v1; split out once the embedding queue backs up.

---

## B. Technology choices

### Kept from the legacy code

- **PostgreSQL.** With the pgvector extension. Keep using it.
- **Next.js 15 + React 19 + Tailwind 4.** The design prototype is itself Tailwind, so migration cost is minimal.
- **TypeScript** across the whole frontend + SDK.

### Dropped from the legacy code

- **Django + DRF + FastMCP + uv** — replaced by the Go stack below. The Django code in `standmeet-server/backend/` is reference only.

### Newly introduced

#### Backend (Go)

- **Go 1.22+**, standard library `net/http` + the **`chi`** router (lightweight, no magic, clear middleware conventions).
- **`sqlc`** for the data layer. We write one `schema.sql` and `queries.sql`; sqlc generates typed Go functions. No runtime ORM magic; a wrong query is a compile error.
- **`pgx/v5`** as the underlying driver (sqlc's recommended backend, supports pgvector together with `pgx-pgvector`).
- **`mark3labs/mcp-go`** for the MCP server (the mainstream community Go MCP SDK, supports the streamable HTTP transport).
- **`goose`** for SQL migrations — plain `*.sql` files with `up`/`down`, run at startup.
- **`golang.org/x/crypto/argon2`** for password hashing (Argon2id).
- **`redis/go-redis/v9`** for sessions / queues / rate limiting.
- **`anthropic-sdk-go`** + **OpenAI Go SDK** for code-tier inference (BYOAI inference never goes through us, see D.2).

#### Edge / infrastructure

- **Caddy 2** reverse proxy + automatic Let's Encrypt + on-demand TLS for custom domains.
- **pgvector** stores embeddings + ANN retrieval. Saves an external vector DB.

#### Frontend

- **shadcn/ui** (heavily themed) for admin's underlying primitives (Dialog / Combobox / Tooltip / Tabs / Toggle). The public surfaces (`index`, `gate`) are hand-built — they are the face of the brand.
- **tsup** to bundle the SDK.

### SDK shape

`sdk/` is a small monorepo (pnpm workspace) with 3 packages:

```
sdk/
├─ packages/
│  ├─ core/    @standmeet/sdk-core   -- API client + types + state machine (no UI)
│  ├─ react/   @standmeet/sdk         -- React components + hooks, depends on core
│  └─ embed/   @standmeet/embed       -- Web Components wrapper layer, depends on react
```

The output is both published to npm and served by each instance under `/sdk/v1/...`, so self-hosting users can point `<script>` straight at their own instance.

### Why this shape

- The Go binary ships as a `FROM scratch` image (about 20 MB); compared with a Python image (about 150 MB + uvicorn workers), the self-hosting footprint shrinks ~7x.
- sqlc + DDD reads cleanly: SQL queries are in `db/queries/*.sql`, generated code in `internal/infra/db/`, business logic in `internal/app/`. No ORM-shaped surprises.
- Splitting out core means the protocol layer can be reused if we add Vue / Svelte adapters later.
- Embed renders React inside a Web Component, costing about 40 KB more gzipped, in exchange for not maintaining two fully separate UI codebases.

### Decision points

**B.1** Adopt shadcn/ui. Saves time on a11y primitives, but adds a dependency. **Recommended:** admin only.

**B.2** pgvector vs external (Pinecone / Qdrant). pgvector is friendlier for self-hosting and enough up to ~1M entries. **Recommended:** pgvector.

**B.3** SDK packaging: React first, with embed shipping Web Components by wrapping React vs two separate codebases. **Recommended:** React first + embed wrapper.

**B.4** Publish `@standmeet/sdk` to npm as well, or only ship it with the instance. **Recommended:** both — npm makes cross-instance use easy; the instance-bundled copy is the default `<script>` source in admin's MCP setup snippet.

**B.5** Migration tool: `goose` (plain `*.sql`, lightweight) vs `atlas` (declarative HCL/SQL + linting). **Recommended:** goose — simple owner deployment matters more than atlas's schema drift detection.

**B.6** Async queue: `asynq` (Redis, simple) vs `river` (Postgres-backed, fewer dependencies). **Recommended:** no queue library at first — plain goroutines + a Redis list; adopt `asynq` once usage grows.

---

## I. Code directory layout

(Placed before C/D/E because it decides where the schema / endpoints live.)

```
standmeet/
├─ CLAUDE.md
├─ README.md
├─ Makefile
├─ docker-compose.yml          ← prod-ish, used by install.sh
├─ docker-compose.dev.yml      ← for dev, hot reload, host mounts
├─ Caddyfile
├─ .env.example
├─ install.sh                  ← one-line self-host install script
│
├─ backend/                    ← new Go server (chi + sqlc + mcp-go), naming aligned with Otium auth
│  ├─ go.mod / go.sum
│  ├─ .golangci.yml            ← copied from Otium auth (v2, default-all + hand-picked disables)
│  ├─ .go-arch-lint.yml        ← enforces the dependency arrows below
│  ├─ Makefile                 ← lint chain: fmt-check / max-lines / routes-cyclo / arch / golangci / escape-lint / secrets
│  ├─ Dockerfile               ← multi-stage build → distroless static output
│  ├─ entrypoint.sh            ← runs migrations with goose up, then starts the server
│  ├─ sqlc.yaml
│  ├─ cmd/
│  │  └─ server/main.go        ← composition root: wires all dependencies, starts HTTP
│  ├─ internal/                ← infra split by external system (aligned with Otium), not a flat infra/
│  │  ├─ domain/               ← entities, value objects, repository interfaces (pure Go, imports nothing internal)
│  │  ├─ usecases/             ← use cases (PromoteRawToWiki, IssueCodeSession, etc.)
│  │  ├─ postgres/             ← sqlc-generated code + Repository implementations (owner_id enforced via ctx)
│  │  ├─ storage/              ← media driver (local / s3)
│  │  ├─ sandbox/              ← helper that starts the builder per build (wraps docker run)
│  │  ├─ inference/            ← anthropic + openai client
│  │  ├─ session/              ← owner session / visitor session / API token / claim
│  │  ├─ middleware/           ← chi middleware (auth.WithOwner lives here)
│  │  ├─ routes/               ← presentation layer
│  │  │  ├─ admin/             ← chi routes for /api/admin/* (session auth)
│  │  │  ├─ public/            ← chi routes for /api/v1/* (visitor session-token auth, CORS open)
│  │  │  └─ internal/          ← /internal/healthz, tls-ask, log
│  │  ├─ mcp/                  ← mcp-go: tools, prompts, resources
│  │  ├─ config/               ← env loader
│  │  └─ server/               ← chi route assembly (no business logic)
│  ├─ db/
│  │  ├─ migrations/           ← goose *.sql
│  │  ├─ schema.sql            ← canonical schema (sqlc input)
│  │  └─ queries/              ← *.sql, one file per aggregate (raw.sql, wiki.sql, codes.sql, …)
│  ├─ scripts/                 ← check-max-lines.sh / check-routes-cyclo.sh (copied from Otium)
│  └─ tests/                   ← integration tests (testcontainers starts PG + Redis)
│
├─ app/                        ← new Next.js
│  ├─ package.json
│  ├─ Dockerfile
│  ├─ next.config.ts
│  ├─ tailwind.config.ts
│  └─ src/
│     ├─ app/
│     │  ├─ (public)/[handle]/page.tsx           ← surface: index
│     │  ├─ (public)/[handle]/gate/page.tsx      ← surface: gate
│     │  ├─ (auth)/login/page.tsx                ← surface: login
│     │  ├─ (auth)/setup/page.tsx                ← first-run claim
│     │  └─ (admin)/admin/[[...slug]]/page.tsx   ← surface: admin (SPA style)
│     ├─ components/                              ← shared, themed
│     ├─ lib/
│     │  ├─ api/                                  ← typed admin + public client
│     │  ├─ auth/                                 ← session helper
│     │  └─ design/                               ← Newsreader/Mono config, color tokens, motion
│     └─ styles/globals.css
│
├─ sdk/                        ← npm packages
│  ├─ pnpm-workspace.yaml
│  └─ packages/
│     ├─ core/                 ← @standmeet/sdk-core
│     ├─ react/                ← @standmeet/sdk
│     └─ embed/                ← @standmeet/embed
│
├─ builder/                    ← sandbox image started per build
│  ├─ Dockerfile               ← node + vite + a thin runner
│  ├─ runner.mjs               ← reads source from stdin/volume, writes dist/
│  └─ template/                ← starter App.tsx using @standmeet/sdk
│
├─ infra/
│  ├─ caddy/                   ← Caddyfile fragments, tls-ask helper
│  └─ scripts/                 ← install.sh, backup.sh, restore.sh
│
├─ e2e/                        ← Playwright, full-stack coverage
│  ├─ package.json
│  ├─ playwright.config.ts
│  └─ tests/
│
├─ docs/
│  ├─ design/                  ← prototype handoff (visual source of truth) + this file
│  └─ <legacy *.md>            ← old vision/distillation docs, kept for reference
│
├─ standmeet-client/           ← legacy reference (Electron)
├─ standmeet-e2e/              ← legacy reference (Playwright)
└─ standmeet-server/           ← legacy reference (old Django monorepo)
```

### Decision points

**I.1** Whether to put a root-level `pnpm-workspace.yaml` covering `app/` / `sdk/` / `e2e/`, so types and the lockfile are shared. The backend stays managed by its Go module and is not in pnpm. **Recommended:** add it.

**I.2** `admin` as a route group (`/admin/*` on the same host) vs a separate hostname. **Recommended:** route group — the owner CNAMEs only one domain, and admin sits under its `/admin`. Smaller DNS/SSL surface.

**I.3** Put `builder/` at the root, not under `backend/`. **Recommended:** root — it is a separate runtime image with its own dependency tree; putting it under backend would blur the boundary.

**I.4** Naming shape for `backend/internal/`. Three options: (a) my original pure DDD naming (`domain/app/infra/interfaces`, with infra subpackages stuffed flat inside); (b) the Go habit of splitting by feature (`internal/corpus`, `internal/codes`); (c) **DDD, but infra split by external system** (`domain/usecases/postgres/storage/sandbox/inference/session/middleware/routes/mcp/config/server`, aligned with the Otium auth service on the same host as [[youteacher]]). **Chosen:** (c) — the owner's existing muscle memory + Go-idiomatic (each infra subpackage is a single-responsibility leaf, and its name says directly which external system it adapts); `.go-arch-lint.yml` enforces the dependency arrows by these components.

---

## C. Data model

Every table has `owner_id uuid not null` with an index. In single-owner v1 every row has the same value; moving to multi-tenancy later needs no migration.

### Tenancy / auth

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

instance_settings                                  -- single row (id=1)
  is_claimed           bool default false
  setup_token_hash     text null                  -- one-time token, sha256(plaintext); plaintext printed to stdout
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
  -- SEO landing page (off by default; the owner turns it on per entry; see J)
  seo_landing_enabled  bool default false
  seo_slug             citext null                -- URL slug; when empty, slugified from title
  seo_title            text null                  -- overrides <title>; empty = use title
  seo_description      text null                  -- overrides meta description
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

### Access control

```
access_codes
  id                  uuid pk
  owner_id            uuid fk
  code                citext unique               -- 'LABEL-XXX'
  label               text                        -- 'OAEN'
  purpose             text                        -- free text, visible to the owner only
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
  is_anonymous        bool                        -- entered as 'someone new'
  last_seen_at        timestamptz null
```

### Visitor conversations

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

### Default page content

```
page_content                                       -- one row per owner; backs the default index surface
  owner_id            uuid pk fk
  hero_prose          text
  hero_examples       jsonb
  insights            jsonb
  projects            jsonb
  status_block        jsonb
  contact_block       text
  -- per-page SEO (no instance-level default; see J)
  seo_title           text null
  seo_description     text null
  seo_og_image_id     uuid null fk -> media_assets
  updated_at          timestamptz
```

### Custom pages (MCP-authored, three-stage publishing)

```
microsites
  id                  uuid pk
  owner_id            uuid fk
  slug                text                        -- '' = root (overrides the default index); '/blog', '/work', …
  packages            jsonb                       -- npm deps from the allowlist (validated server-side against the allowlist)
  draft_files         jsonb                       -- {path: contents}; current state written live through MCP
  staging_build_id    uuid null fk -> microsite_builds
  live_build_id       uuid null fk -> microsite_builds
  staging_url_token   text null                   -- unguessable token; staging URL = host/_stage/{token}/...
  staged_at           timestamptz null
  live_at             timestamptz null
  -- per-microsite SEO (same as page_content; injected into the served page's <head>)
  seo_title           text null
  seo_description     text null
  seo_image           text null                   -- OG / Twitter card image
  created_at          timestamptz
  unique(owner_id, slug)

microsite_builds                                 -- immutable artifact record
  id                  uuid pk
  page_id             uuid fk -> microsites
  status              text                        -- 'building' | 'built' | 'failed'
  build_log           text                        -- truncated to 64 KB
  output_path         text null                   -- 'custom/{owner_id}/{build_id}/'
  source_snapshot     jsonb                       -- files at build time (for rollback / audit)
  packages_snapshot   jsonb
  started_at          timestamptz
  finished_at         timestamptz null
  error               text null
```

The three publishing states (`draft` / `staging` / `live`) are derived columns:

- **draft** — `draft_files` changed since the last build.
- **staging** — `staging_build_id` is non-null, points to a build with status `built`, and is served at `/_stage/{staging_url_token}/`.
- **live** — `live_build_id` is non-null and is served at the owner's public path (`/{slug}`).

promote = "copy the chosen build_id into the target field". rollback = "set `live_build_id` back to some earlier build". History is never deleted — it is both the audit trail and the safety net.

### API token / connector

```
api_tokens                                         -- follows youteacher's simplified approach: no scope, no prefix, revoke = hard delete
  id              uuid pk
  owner_id        uuid fk
  name            text                             -- named after the machine/device ("mojat-mbp", "galaxy-tab")
  token_hash      text unique                      -- sha256(plaintext); plaintext shown only once
  scopes          text[] default '{*}'             -- v1 full access; schema reserved for future coarse/fine granularity
  last_used_at    timestamptz null
  created_at      timestamptz
  -- revoke = DELETE FROM api_tokens WHERE id=... (hard delete, no revoked_at kept)

connectors
  id              uuid pk
  owner_id        uuid fk
  kind            text                            -- 'email' | 'calendar'
  provider        text                            -- 'google' | 'outlook'
  enabled         bool
  oauth_token     bytea null                      -- encrypted at rest (AES-GCM, key read from env)
  oauth_refresh   bytea null
  meta            jsonb
```

### Indexes (non-primary-key)

- `owners(email)` unique, `owners(handle)` unique, `owners(custom_domain)` unique partial where not null
- `raw_entries(owner_id, created_at desc)`, `raw_entries(owner_id, archived) where archived=false`
- `wiki_entries(owner_id, visibility)`, `wiki_entries USING ivfflat (embedding vector_cosine_ops)`
- `access_codes(code)` unique, `access_codes(owner_id, status)`
- `messages(conversation_id, created_at)`
- `api_tokens(token_hash)` unique
- `microsites(owner_id, slug)` unique
- `microsite_builds(page_id, started_at desc)`
- `wiki_entries(owner_id, seo_slug) where seo_landing_enabled` unique partial — SEO landing routes

### Decision points

**C.1** When embeddings are computed. Synchronously on write vs an async queue. **Recommended:** async — `promote_to_wiki` returns immediately; until the embedding is computed, retrieval falls back to lexical search.

**C.2** `page_content` as a JSONB blob vs split relational tables. JSONB matches admin's whole-block editing semantics. **Recommended:** JSONB; one row per owner; if a field later becomes a retrieval hotspot, split it into its own column.

**C.3** Media storage. Local filesystem (mounted volume) vs S3-compatible. **Recommended:** local by default + a pluggable driver — `storage_key` works for both; install.sh sets `STORAGE_DRIVER=local`.

**C.4** Tag system. Free `text[]` vs a separate `tags` table with FKs. **Recommended:** free text; add `tag_aliases` later if the owner's tags get messy.

**C.5** Owner-id enforcement layer. Go has no Manager pattern; the equivalent is to wrap the sqlc-generated queries in a **Repository** whose every method takes `ownerID` as its first parameter, and never expose bare queries. Add a custom vet check (`cmd/lint/owneridvet`) that flags any code calling sqlc functions outside the Repository. **Recommended:** Repository pattern + vet check. Add Postgres RLS as a safety net when multi-tenancy is actually built.

**C.6** npm package allowlist for custom pages. The sandbox cannot let the owner's AI npm install arbitrary code. Maintain an allowlist (`react`, `framer-motion`, `lucide-react`, `clsx`, `@standmeet/sdk`, …) and validate it server-side before calling the builder. **Recommended:** list ~15 common packages for v1 and extend as needed.

**C.7** Build retention policy. `microsite_builds` keeps piling up. **Recommended:** keep the latest 20 per page + keep the current `live_build_id` forever + clean up the rest after 30 days.

---

## D. API design

3 separate API surfaces. Each has its own auth, its own schema, its own audience. Same Go binary, different chi sub-routers.

### D.1 Admin REST API — `/api/admin/*`

- **Audience:** the owner's browser (the admin Next.js surface).
- **Auth:** session cookie + CSRF on state-changing requests.
- **CORS:** same origin (admin and public are on the same instance domain).

```
GET    /api/admin/me
POST   /api/admin/me/logout

GET    /api/admin/raw                       ?source=&tag=&q=
POST   /api/admin/raw                       -- manual dump (admin's quick-dump box)
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
DELETE /api/admin/codes/:id                 -- revoke (soft delete)
POST   /api/admin/codes/:id/members
DELETE /api/admin/codes/:id/members/:mid

GET    /api/admin/conversations             ?code_id=&tier=
GET    /api/admin/conversations/:id

GET    /api/admin/page
PUT    /api/admin/page                      -- atomically replace the default page blocks

POST   /api/admin/media                     -- multipart upload (manual upload from admin)
GET    /api/admin/media                     ?attached_to=
DELETE /api/admin/media/:id

GET    /api/admin/tokens
POST   /api/admin/tokens                    -- the response contains the plaintext once only
DELETE /api/admin/tokens/:id

GET    /api/admin/connectors
POST   /api/admin/connectors/:kind/oauth/start    -> {redirect_url}
GET    /api/admin/connectors/:kind/oauth/callback

# Microsites — monitoring / lifecycle only. **No** source file CRUD.
GET    /api/admin/microsites              -- list + derived status (draft/staging/live)
GET    /api/admin/microsites/:id
GET    /api/admin/microsites/:id/builds   -- recent build history
POST   /api/admin/microsites/:id/publish  {build_id}  -- promote a built build to live
POST   /api/admin/microsites/:id/rollback              -- previous live_build_id
POST   /api/admin/microsites/:id/unpublish             -- live_build_id := null
DELETE /api/admin/microsites/:id

# SEO — per-page SEO, no instance-level default (see J)
PUT    /api/admin/microsites/:slug/seo     { seo_title, seo_description, seo_image }   -- the microsite's own SEO
# Site default SEO = the homepage microsite's own per-page SEO
# per-entry corpus SEO (publish/unpublish a wiki/output entry + set excerpt):
#   PATCH /api/admin/corpus/:genre/:id/seo
```

Source file authoring goes entirely through MCP, not here (see D.3).

### D.2 Public API — `/api/v1/*`

- **Audience:** SDK clients (the instance's own Next.js public pages + any third-party site embedding the SDK).
- **Auth:** a Bearer session token issued by `POST /api/v1/sessions`. Opaque, Redis-backed, TTL 60 minutes, sliding renewal up to 8 hours.
- **CORS:** read endpoints fully open; write endpoints restricted (currently only sessions).

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
  events: token delta, tool_call_start, tool_call_end, citation, done, error

GET    /api/v1/page/:handle                -- default page content (read-only, includes seo meta)
GET    /api/v1/page/:handle/byoai-config   -- {enabled, providers, public_blurb}
GET    /api/v1/sdk/v1/manifest             -- SDK build metadata (for the instance-bundled <script>)

# Public SEO endpoints (accessed directly by crawlers; see J)
GET    /robots.txt                         -- generated dynamically by the backend; claimed + public_url → allow, otherwise disallow
GET    /sitemap.xml                        -- lists the default page + all live microsites + all seo_landing_enabled wiki entries
GET    /api/v1/wiki/:handle/:seo_slug      -- indexable content of a public wiki entry (only seo_landing_enabled entries are accessible)
GET    /api/v1/og/page/:handle             -- auto-rendered default page OG image (PNG)
GET    /api/v1/og/custom/:page_id          -- auto-rendered microsite OG image
GET    /api/v1/og/wiki/:wiki_id            -- auto-rendered wiki landing OG image
```

### D.3 MCP server — `/mcp/`

- **Audience:** the owner's AI clients (Claude Desktop, Cursor, …).
- **Auth:** `Authorization: Bearer smk_…`.
- **Protocol:** `mcp-go`'s streamable HTTP transport.

**Tools — corpus (ingest):**

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

**Tools — microsites (this tool set is the entire authoring surface):**

```
# Lifecycle
microsite.list()
  -> [{id, slug, has_draft, staging_url?, live_url?, last_build}]
microsite.create(slug, template?='blank')
  -> {page_id}
microsite.delete(page_id)

# File editing — the AI writes React source through these tools
microsite.list_files(page_id)
  -> [{path, size}]
microsite.read_file(page_id, path)
  -> {contents}
microsite.write_file(page_id, path, contents)
microsite.delete_file(page_id, path)
microsite.set_packages(page_id, deps)
  -- deps are validated against the server-side allowlist (see C.6)

# Build and publish
microsite.build(page_id)
  -> {build_id}                                     -- async; starts the builder container
microsite.get_build(page_id, build_id?)
  -> {status, log, finished_at, error?}             -- build_id omitted = latest
microsite.promote_to_staging(page_id, build_id?)
  -> {staging_url}                                  -- URL with an unguessable token
microsite.promote_to_live(page_id, build_id?)
  -> {live_url}
microsite.rollback(page_id)
  -- live_build_id := the previous live build
```

**Tools — SEO (see J):**

```
# per-microsite SEO (the homepage microsite is the site default)
microsite.set_seo(page_id, {seo_title?, seo_description?, seo_image?})

# per-entry corpus SEO (publish/unpublish a wiki/output entry + set excerpt)
seo.set_entry_seo(genre, id, {published?, excerpt?})
```

While writing a microsite, the AI can also call `microsite.set_seo(page_id, {seo_title: ..., seo_description: ...})`, so the owner does not need to leave and configure it by hand.

The owner's typical flow:

> Owner (in Claude Desktop): "Add a `/blog` page for me, and pull the 5 most recent visibility=public entries from my wiki as the hero."
> AI: calls `microsite.create('/blog')` → `search_wiki(visibility='public', limit=5)` → a few `write_file()` calls → `build()` → polls `get_build()` until built → `promote_to_staging()` → reads the staging URL back.
> Owner: opens it in a browser. "The hero text is too small, make it twice as big."
> AI: `write_file()` + `build()` + a new staging URL.
> Owner: "Ship it."
> AI: `promote_to_live('/blog')`.

The "Microsites" section in admin is the monitoring panel for all the actions above — page list, derived status, staging/live URLs, manual `publish` / `rollback` / `unpublish` / `delete` buttons. It does **not** provide an editor, an embedded chat or a preview iframe.

### D.4 Internal endpoints — `/internal/*`

- `/internal/healthz` — Caddy liveness probe + uptime.
- `/internal/tls-ask?domain=…` — the gatekeeper endpoint for Caddy on-demand TLS. Returns 200 if and only if the domain matches some owner's `custom_domain_status='verified'`.
- `/internal/log` — frontend error reporting (rate limited).

### Decision points

**D.1** Chat stream over SSE vs WebSocket. SSE is HTTP, friendly to CORS / proxies / browsers; it loses bidirectional communication, which we do not need. **Recommended:** SSE.

**D.2** The BYOAI key path. The visitor's API key should never reach our server. Flow: the server returns RAG context + the filtered scope; the SDK calls `api.anthropic.com` / `api.openai.com` directly with the visitor's key. A server proxy is simpler but makes us responsible for storing visitor keys. **Recommended:** direct client calls, two steps (RAG → infer).

**D.3** MCP auth — API tokens now, OAuth later. The owner creates a token in admin and pastes a JSON snippet into Claude Desktop. Some friction, but stable for v0. **Recommended:** API tokens for v1; add OAuth in v2 once the MCP OAuth conventions settle.

**D.4** Session token storage. Server-side opaque Redis (instantly revocable) vs JWT (stateless, revocation needs a deny-list). When the owner revokes a code it must take effect immediately. **Recommended:** opaque + Redis.

**D.5** Idempotency of `raw_dump`. The AI may retry on transient failures and cause duplicate writes. **Recommended:** MCP write tools require a `request_id` (uuid) header; the server dedupes within a 1-hour window.

**D.6** Write idempotency for custom pages. `write_file` is naturally idempotent (content overwrite). `build` is subtler — concurrent builds of the same page should coalesce (return the running `build_id`) rather than queue. **Recommended:** coalesce; at most one in-flight build per page.

---

## E. Auth

5 auth scenarios:

| Scenario | Entry point | Mechanism |
|---|---|---|
| First-run instance claim | `/setup?t=<token>` | One-time `setup_token`, printed to the console |
| Owner login | `/login` | Email + password → session cookie |
| MCP client | `/mcp/*` | `Authorization: Bearer smk_…` (API token) |
| Visitor code access | `/api/v1/sessions` | code → opaque session token |
| Visitor BYOAI access | `/api/v1/sessions` | `byoai: true` → opaque session token (public scope only) |

### First-run claim flow

1. The container starts. `instance_settings.is_claimed=false`. The backend generates a one-time `setup_token`, stores `sha256(token)` in `instance_settings.setup_token_hash`, and prints the plaintext to stdout:
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │ STANDMEET is ready. Open this link to claim it:             │
   │   https://your-domain.example/setup?t=eyJh…                 │
   └─────────────────────────────────────────────────────────────┘
   ```
   It also writes the URL to `/srv/first-run.txt` (deleted automatically after claim), for users who do not watch the logs.
2. The owner opens the link → setup page → fills in email/password/handle/name → `POST /api/admin/claim {token, …}`.
3. The backend verifies the token, creates the owner, marks `is_claimed=true`, and clears `setup_token_hash` and the file. This endpoint rejects calls from then on.
4. The owner is logged in automatically.

### Owner-id propagation

- The chi middleware `auth.WithOwner` runs early on every authenticated route. It reads the session cookie / bearer token / visitor session token (whichever path applies), resolves the `owner_id`, and puts it into `context.Context` under a typed key.
- Repository methods take `ctx context.Context` as their first parameter; inside the method they read `owner_id` from the context, and if it is missing they panic (in dev mode) / refuse to run.
- A custom vet check (`cmd/lint/owneridvet`) flags any code that calls sqlc functions outside a Repository method, so we cannot bypass the filter.

### Session details

- The owner cookie is named `smt_session`, HttpOnly, Secure, SameSite=Lax, Path=/api/admin.
- Redis-backed: `session:{token}` → `{owner_id, expires_at, csrf_token}`.
- CSRF: double-submit cookie pattern; the frontend fetches it at bootstrap via `GET /api/admin/csrf`.

### Visitor session token

- 32 random bytes + base64url, prefix `smv_`.
- Redis: `vsession:{token}` → `{owner_id, code_id?, member_id?, scope, byoai?, expires_at}`.
- TTL 60 minutes, sliding renewal on each request, up to 8 hours.

### API token

Design principle borrowed from [[youteacher]]: minimal; the owner trusts the tokens they configure for their own AI.

- Plaintext format `smk_<24-char-base32>`. The backend stores only `sha256(plaintext)`.
- Created in admin; the plaintext is visible only at the moment of creation.
- `name` is named after the machine/device ("mojat-mbp", "galaxy-tab"); the admin form's placeholder suggests filling it in this way.
- Revoke = `DELETE FROM api_tokens WHERE id=...` (hard delete); the middleware's next check fails and returns 401 immediately.
- v1 has no scopes — any AI client holding a token can call every MCP tool. The `scopes` column holds `'{*}'` as a placeholder, so tiers can be enabled later when needed (IM bridge / public intermediary tokens).
- The list endpoint returns metadata only (`id` / `name` / `created_at` / `last_used_at`), never the hash or the plaintext.

### Decision points

**E.1** How the setup token is delivered. Console print + host file. **Recommended:** do both.

**E.2** Password hashing. Argon2id from `golang.org/x/crypto/argon2`. **Recommended:** Argon2id, default parameters `time=3, memory=64 MB, threads=4`.

**E.3** CSRF pattern. Double-submit cookie + an `X-CSRFToken` header on admin state-changing requests. **Recommended:** the standard approach, via `/api/admin/csrf` at bootstrap.

**E.4** API token scope granularity. Not in v1 (`scopes='{*}'` placeholder, every token has full access); the schema keeps the column, and when untrusted clients arrive (IM bridge public bot, third-party intermediaries) we enable three coarse tiers (`mcp:read` / `mcp:write` / `mcp:pages`). **Chosen:** not in v1 (aligned with the similar design in [[youteacher]]).

**E.5** Cross-origin admin. **Recommended:** not allowed in v1; admin lives at `/admin` on the same host as public.

---

## F. Multi-tenancy reservations

Shape: v1 is wired for a single owner everywhere, but the **data** and the **URLs** are already multi-tenant shaped.

### Data layer

- Every domain table has `owner_id`.
- Repository methods take `ownerID` from `context.Context`; no method exposes an "all owners" view.
- Storage paths are prefixed `{owner_id}/…`.
- Builder output paths are prefixed `custom/{owner_id}/{build_id}/…`.

### URL layer (v1 vs v2)

| Surface | v1 (single owner) | v2 (multi-tenant) |
|---|---|---|
| Public chat | `/` → middleware rewrites to `/{owner_handle}` | `/{handle}` |
| Gate | `/gate` → `/{handle}/gate` | `/{handle}/gate` |
| Admin | `/admin` (requires owner login) | `/admin` (owner login + automatic scoping) |
| Login | `/login` | `/login` |
| Setup | `/setup?t=` | replaced by `/signup` |
| Custom page | `/{slug}` → `/{owner_handle}/{slug}` | `/{handle}/{slug}` |
| Staging custom page | `/_stage/{token}/...` (the token contains the owner_id) | unchanged |

The v1 middleware folds `/` into the single owner's `/{owner_handle}`; v2 removes that middleware and serves `/[handle]` directly. The switch needs very little change.

### Switch

`instance_settings.multi_tenant: bool`. It controls:
- whether `/setup` is still reachable after the first claim
- whether `/signup` is enabled
- whether `POST /api/admin/claim` accepts new owners

### Decision points

**F.1** v2 domain strategy: a `/{handle}` path vs a `{handle}.domain` subdomain. Subdomains feel more like a "personal page", but need wildcard SSL + DNS. **Recommended:** plan for both; v1 uses paths; v2 controls it with `multi_tenant_url_style ∈ {path, subdomain}`.

**F.2** Custom domain ownership. With multi-tenancy, one instance serves several custom domains. Caddy on-demand TLS calls `/internal/tls-ask?domain=…`. **Recommended:** already covered by the data model.

**F.3** Storage isolation. Local filesystem paths under `{owner_id}/…` are soft isolation. **Recommended:** accept soft isolation for v1; log a v2 task: harden it with per-owner UIDs + quotas.

---

## G. Deployment / runtime

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
      - SESSION_KEY                              # cookie signing
      - STORAGE_DRIVER=local
      - STORAGE_ROOT=/srv/media
      - BUILDER_IMAGE=standmeet/builder:latest
      - DOCKER_HOST=unix:///var/run/docker.sock  # lets the backend start the builder
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

The `builder` service is **not** in compose — the backend starts it through the Docker socket on each `microsite.build()`.

### Backend Dockerfile (multi-stage)

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

At startup it runs `goose up`, reading from `/migrations`. The final image is ~25 MB, with no shell and no package manager, and runs as nonroot.

### Caddyfile (draft)

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
  handle_path /_stage/*    { reverse_proxy backend:8000 }   # the backend serves staging by token
  reverse_proxy app:3000
}

:443 {
  tls { on_demand }
  @custom not host {$STANDMEET_DOMAIN}
  reverse_proxy @custom app:3000
}
```

### Install script `install.sh`

```sh
#!/bin/sh
# 1. Check for docker and docker compose
# 2. Clone the repo or download the release tarball
# 3. Ask for STANDMEET_DOMAIN, STANDMEET_EMAIL
# 4. Generate a .env with a random SESSION_KEY + DB_PASSWORD
# 5. docker compose pull && docker compose up -d
# 6. Tail the backend log until the "STANDMEET is ready" banner, then print the setup URL
```

### Migration

The backend entrypoint runs `goose up` before starting the HTTP server. Destructive migrations are flagged in red in the release notes; major version changes are written to `MIGRATION.md`.

### Backup / restore

- `make backup` → `pg_dump` + tar of `media/` + `microsites/` → one dated tarball.
- `make restore TARBALL=…` → loads it into clean volumes.
- v1: no automatic scheduling; the docs give a cron one-liner.

### Decision points

**G.1** On-demand TLS rate limiting (through the ask endpoint). **Recommended:** the ask endpoint checks `custom_domain_status='verified'`.

**G.2** Zero-downtime upgrades. **Recommended:** not in v1; accept 5–10 seconds of downtime during `docker compose up`.

**G.3** How migrations run. Automatic `goose up` at startup vs an explicit `make migrate` (not built yet — this is the rejected half). **Recommended:** automatic + a `MIGRATE_ON_START=false` escape hatch.

**G.4** Builder isolation strength. `docker run --rm` + `--network=none` + dropped capabilities + read-only root + tmpfs `/tmp` + seccomp profile + memory/CPU limits + 60s timeout. Anything harder means gVisor / Firecracker. **Recommended:** v1 uses docker run + the hardening above; the docs describe the upgrade path to gVisor.

**G.5** The backend container needs the Docker socket to start the builder. This is a privilege escalation risk (if the backend is compromised, it is game over). Alternatives: rootless Podman, or a thin `builder-broker` daemon. **Recommended:** v1 gives it the socket directly (the backend is the trust boundary anyway); evaluate `builder-broker` in v2.

---

## H. Observability / error handling

### Logging

- **Backend:** `slog` writes structured JSON logs to stdout. Fields: `ts, level, owner_id?, request_id, route, msg`.
- **Frontend:** errors are reported to `/internal/log` (rate limited).
- **Caddy:** JSON access log.
- **Builder:** stdout is captured into `microsite_builds.build_log`; the owner views it through the `microsite.get_build()` MCP tool or the admin list.

### Health checks

- `GET /internal/healthz` — returns 200 when PG + Redis are reachable.
- Caddy waits for this before routing.

### User-visible errors (following the principles in CLAUDE.md)

Standard envelope:

```json
{ "error": { "code": "tier_insufficient", "message": "...", "hint": "..." } }
```

The frontend has one `friendlyError(code)` helper that maps a code to displayable copy. Fallback `"Something went wrong"` — never expose stack traces, exit codes or Go panic strings.

| code | Meaning | UI display |
|---|---|---|
| `code_invalid` | access code is wrong or revoked | "That code isn't right. Check it again, or request access." |
| `code_expired` | access code has expired | "The code has expired. Ask the owner for a new one." |
| `tier_insufficient` | public/byoai tier touched private content | inline "You can only see public content; to go further you need a code" block |
| `byoai_disabled` | the owner turned off BYOAI | "The owner hasn't enabled BYOAI. Use an access code to get in." |
| `ratelimited` | too many requests | "Slow down — try again in a minute." |
| `not_found` | handle does not exist / 404 | standard 404 page |
| `build_failed` | sandbox build failed (custom page) | admin shows the truncated log |
| `package_not_allowed` | custom page used an npm package outside the allowlist | admin shows which package + how to request it |
| `server_error` | fallback | "Something went wrong." (with the request_id for troubleshooting) |

### Metrics

- v1: structured logs, ad-hoc queries.
- v2: `/internal/metrics` exposes a Prometheus exporter, behind basic auth.

### Decision points

**H.1** Anonymous telemetry. **Recommended:** not in v1; self-hosting users are sensitive to it.

**H.2** Frontend error reporter. **Recommended:** self-hosted; v2 makes the Sentry DSN configurable.

**H.3** Request ID propagation. Caddy generates it → forwards `X-Request-ID` to the backend → echoed back in the error envelope. **Recommended:** do it.

**H.4** Build log size limit. **Recommended:** truncate at 64 KB + a `(truncated)` marker.

---

## J. SEO (fully owner-controlled)

StandMeet's pages are the public storefront, so SEO must be fully controlled by the owner. This section gathers the SEO fields scattered through C/D in one place, and sets the implementation strategy for the dynamic outputs: OG images, sitemap and robots.

### Per-page SEO (no instance-level default)

```
per-page SEO       ← held by each microsite / each published wiki·output entry
        │
        ▼
final <head>        ← rendered by server SSR
```

- **per-microsite** lives in `microsites`: `seo_title` / `seo_description` / `seo_image`, edited in the editor (`microsite.set_seo` / `PUT /api/admin/microsites/:slug/seo`).
- **Site default SEO** is not a separate layer: it is **the homepage microsite's own per-page SEO**. There is no instance-wide SEO settings table.
- **Merge rules:** none. Each page reads its own row; when a field is empty, the server derives a default from that page's real content (for example, the homepage `<meta description>` is derived from `hero_prose`, and wiki/output landing pages from the entry content).

### Wiki SEO landing pages

- Default `seo_landing_enabled=false`: a wiki entry is RAG material only, and visitors see no standalone URL.
- When the owner thinks a wiki entry deserves its own exposure (long-form, has SEO value), they flip the switch or ask the AI to call `seo.set_wiki(id, {landing_enabled: true})`.
- Once enabled: `GET /api/v1/wiki/:handle/:seo_slug` returns a rendered page with the full wiki body + an "Ask sijie about this" button (it jumps into a chat whose context is prefilled with that wiki entry).
- It goes into `sitemap.xml` automatically.
- `seo_slug` must be unique within the owner (the index exists); when empty, it is slugified from the title.

### `<head>` contents

The server builds `<head>` from each page's per-page SEO fields: `<title>` + `<meta name="description">` + Open Graph (`og:title` / `og:description` / `og:image`) + Twitter card. When a field is empty, it derives a default from that page's real content (see above).

> The early design had owner-level structured fields (GA / Search Console / `extra_head_html`) and a catch-all HTML injection; these were removed together with the global SEO settings and are not in the current implementation.

### sitemap.xml

Generated dynamically by the backend, cached for 5 minutes. It contains:

- the default page `/{handle}` (or `/` in v1)
- all microsites in `live` state, at path `/p/<slug>`
- all wiki entries with `seo_landing_enabled=true`

Each entry has `<lastmod>` from `updated_at`, `<changefreq>` defaulting to `monthly`, and `<priority>` defaulting to 0.5 (microsites 0.8).

### robots.txt

Generated dynamically by the backend, with no index switch and no owner override. The rules follow the instance state:

- **Claimed and has a `public_url`** → indexable (allow):

  ```
  User-agent: *
  Allow: /
  Sitemap: https://{public_url}/sitemap.xml
  ```

- **Not claimed or no `public_url`** → disallow everything:

  ```
  User-agent: *
  Disallow: /
  ```

### Automatic OG image generation

Every public page needs a 1200×630 social sharing card. Three strategies:

1. **next/og (Vercel's SVG → PNG renderer)** renders in a `/api/og/*` route under `app/`. The card design is written in React JSX, satori converts it to SVG, resvg converts it to PNG, sharp outputs it. The code matches the design stack.
2. **Go rendering**: the backend draws it with `golang.org/x/image/font` or `fogleman/gg`. Good performance, but painful to write layouts in.
3. **Owner upload**: upload a PNG as the default; no automatic rendering.

**Recommended: 1 + 3 together**: when `og_image_id` is empty, render automatically with next/og (including owner.full + handle + a one-line tagline + colors taken from the current tokens); when the owner wants precise control, they upload an image. The app's og endpoint is served at `/api/v1/og/*`, backed by the app service, cached for 30 days.

### Person schema (JSON-LD)

The server builds one automatically from the owner profile:

```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Sijie Wang",
  "url": "https://sijie.example",
  "address": { "@type": "PostalAddress", "addressLocality": "Markham, Ontario" },
  "knowsAbout": [...top 5 by frequency of wiki tags...],
  "sameAs": [...future: links to GitHub / LinkedIn / Twitter and other connectors...]
}
```

(The early design had a `person_schema_override` where the owner supplied JSON to replace it entirely; it was removed together with the global SEO settings.)

### SEO editing in admin

There is no standalone global SEO panel (the early design's `/admin/seo` was removed). SEO is edited next to the object it belongs to:

- **per-microsite** — set `seo_title` / `seo_description` / `seo_image` in the microsite editing flow.
- **per-entry corpus** — publish/unpublish a wiki·output entry + set excerpt (`seo.set_entry_seo` / `PATCH /api/admin/corpus/:genre/:id/seo`).

### Decision points

**J.1** OG image rendering: next/og (Node renders in the app container) vs Go (renders in the backend). **Recommended:** next/og. Matches the design stack; layouts are written in JSX.

**J.2** Sitemap caching: recompute per request vs 5-minute in-memory cache vs Redis cache. **Recommended:** 5-minute in-memory (after an owner update, the next crawler request sees the old version for at most 5 minutes, which is acceptable).

**J.3** The "Ask sijie about this" CTA on wiki landing pages: on entering chat, prefill a question ("tell me more about: {wiki.title}"), or stuff the wiki body directly into the conversation as context? **Recommended:** prefill the question (keeps the chat surface consistent; does not pollute the conversation context).

**J.4** Whether wiki landing pages affect chat's retrieval scope. If a wiki entry has `seo_landing_enabled=true` but `visibility='private'`, we get an odd case where it is publicly indexable but chat refuses to cite it. **Recommended:** enforce that `seo_landing_enabled=true` requires `visibility='public'`, validated server-side.

**J.5** Canonical URL default. Once a custom domain is set, should canonical point to the custom domain or the instance domain? This affects which URL the major search engines treat as the primary version. **Recommended:** once the custom domain is verified, every canonical points to the custom domain automatically.

---

## Cross-cutting principles

1. **owner_id is non-negotiable.** Every domain table, every query, every storage path carries it. The Repository takes it from `ctx`; the vet check is the safety net.
2. **Three API surfaces, three auth schemes, one process.** Do not merge admin and public endpoints "for convenience".
3. **The SDK is a first-class consumer of the public API.** If something is hard to express in the SDK, the API design is wrong.
4. **MCP is the owner's authoring channel, not just an ingest channel.** Any owner-side workflow where AI involvement adds value (raw → wiki, writing custom pages, tagging, future ghostwriting, replying) becomes a tool set, not an admin UI feature. The admin UI is only responsible for monitoring and explicit safe controls (publish, rollback, revoke).
5. **Self-hosting friendliness > more features.** Anything that needs an external SaaS account is a v2 matter.
6. **Errors are UI copy.** Backend codes are stable; frontend strings are localized; never leak internal details.
7. **SEO is the owner's writing surface, not the server's default behaviour.** The owner controls `<title>` / meta description / og per page; there is no instance-level global SEO setting, and the site default is the homepage microsite's own per-page SEO. When a field is empty, the server derives a default from that page's real content.

---

## Open questions this document does not resolve

These are known unknowns, left for separate later decisions:

- **Who pays for inference in code-tier conversations** — does the owner configure their own Anthropic/OpenAI key? Stored in a `connector` or an env var? The schema accommodates both; the admin UX for it is not designed yet.
- **IM bridge (Telegram/Discord/Slack)** — not in the first slice. The data model already accommodates it (`raw_entries.source='telegram-bot'`; visitor sessions via access code through bot DMs).
- **Electron client** — same as above. The ingest channel is already supported; the UX is outside this document's scope.
- **Connectors (Email / Calendar)** — the schema exists; tool call rendering in chat (`tool_calls jsonb`) supports calendar slot proposals; the full OAuth flow is still to be designed.
- **Custom page allowlist governance** — who decides the allowlist, how the owner requests a new package, and whether the allowlist itself is a versioned config file.

---

*End of the code architecture draft. Decision point feedback format: `A.1: accept` or `B.1: change — no shadcn, hand-build every primitive`.*
