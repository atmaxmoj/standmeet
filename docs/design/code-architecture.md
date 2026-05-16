# StandMeet Code Architecture

> **Status:** Draft for owner review (revised 2026-05-16; backend switched to Go, builder turned into an MCP-driven workflow).
> **Audience:** People who will build this. Assumes you've read `CLAUDE.md` for product context and `docs/design/chats/chat1.md` for visual intent.
> **How to give feedback:** Every block ends with a numbered list of decision points (`A.1`, `A.2`, …). Reply with `Aₙ: accept` or `Aₙ: change — <reason / new direction>`. Anything not mentioned is taken as accepted.

---

## TL;DR — Single shape of the system

```
                ┌─── 80 / 443 ───┐
                │     Caddy      │  ← auto Let's Encrypt + on-demand TLS for custom domains
                └────┬───────────┘
        ┌────────────┼─────────────────────┐
        │            │                     │
   ┌────▼────┐  ┌────▼─────┐         ┌─────▼──────┐
   │   app   │  │ backend  │         │  /custom   │
   │ Next.js │  │   Go     │         │ static     │
   │ :3000   │  │  +chi    │         │ (volume)   │
   └─────────┘  │ +mcp-go  │         └────────────┘
                │  :8000   │
                └────┬─────┘
            ┌────────┼─────────┐
       ┌────▼──┐ ┌───▼────┐ ┌──▼──────────┐
       │  PG   │ │ Redis  │ │  Builder    │
       │ pgvec │ │        │ │  sandbox    │
       └───────┘ └────────┘ │ (per build) │
                            └─────────────┘
```

5 long-running containers (caddy / app / backend / pg / redis) + 1 on-demand container (builder), spawned by backend in response to MCP tool calls from the owner's AI client. Single docker compose. Self-hosted, single command to start.

### One paragraph on the builder

`custom_pages` (multi-slug per owner) are authored **entirely via MCP tools called from the owner's own AI client** (Claude Desktop, Cursor, etc.). Admin's "Custom pages" section is a **monitoring panel** — list, status, staging URL, publish/rollback — it does not host an editor, a chat, or a preview. Inference cost stays on the owner's existing AI subscription; StandMeet's backend pays only for sandbox builds.

---

## A. System topology

### Constraints

- One command brings up the whole stack (`docker compose up -d`).
- Automatic SSL for the instance's own domain and for owner custom domains.
- Single owner v1; multi-tenant in the data layer.
- SDK runs in third-party browsers — API must be CORS-safe.
- MCP server reachable by owner's AI clients over HTTPS.
- Page-builder sandbox executes owner-supplied code; isolation required.

### Recommended shape

Five long-running services:

1. **`caddy`** — reverse proxy, TLS terminator, on-demand TLS for custom domains.
2. **`app`** — Next.js 15. Renders 4 surfaces (`index` / `gate` / `admin` / `login`). Talks to backend over HTTP.
3. **`backend`** — Go binary serving 3 logical API namespaces (admin / public-v1 / mcp) on the same port. DDD layering (`domain` / `app` / `infra` / `interfaces`).
4. **`db`** — PostgreSQL 16 with pgvector.
5. **`redis`** — sessions, queues, rate limits.

One on-demand service:

6. **`builder`** — sandboxed container spawned per `custom_page.build()` MCP call, writes static output to a shared volume, exits.

Optional / later:

- **`worker`** — separate process for async work (embedding computation, email sending). Until proven needed, runs as in-process goroutines fed by an async queue.

### Why this shape

- Three responsibilities (proxy / web / API) are independently scaled and reasoned about. More containers = more compose lines, but the boundaries match how we'll debug and rebuild.
- Backend as a single Go binary consolidates REST + MCP + RAG behind one auth surface. We don't want MCP and REST diverging on what an "access code" is.
- Builder isolated from backend because owner-supplied code is untrusted.

### Decision points

**A.1** SSR strategy. Public pages (`/[handle]`, `/[handle]/gate`) are SEO-sensitive → SSR. Admin is auth-gated → CSR (simpler, smaller bundle). **Recommend:** mixed, public SSR, admin CSR.

**A.2** MCP server placement. In-process with backend (same Go binary) or separate container. **Recommend:** in-process — shares auth (API tokens), shares the data layer (sqlc-generated queries), and `mcp-go` plugs cleanly into a chi router.

**A.3** Builder lifecycle. Long-running build server (legacy pattern) vs spawn-per-build. **Recommend:** spawn-per-build via `docker run` (or k8s job equivalent), triggered by an MCP tool call (`custom_page.build`). Most owners rebuild rarely; idle build server wastes RAM and is an attack surface.

**A.4** Async work. In-process goroutines fed by a Redis-backed queue (`asynq` or `river`) vs a separate worker container. **Recommend:** in-process v1; promote to separate container if/when embedding queues bloat.

---

## B. Tech choices

### Keep from legacy

- **PostgreSQL.** Add pgvector extension. Stays.
- **Next.js 15 + React 19 + Tailwind 4.** Design prototype is already Tailwind; trivial port.
- **TypeScript** everywhere on the frontend / SDK.

### Drop from legacy

- **Django + DRF + FastMCP + uv** — replaced by the Go stack below. Existing Django code under `standmeet-server/backend/` becomes reference only.

### New introductions

#### Backend (Go)

- **Go 1.22+** with the standard `net/http` and **`chi`** router (light, no magic, conventional middleware).
- **`sqlc`** for the data layer. We write `schema.sql` and `queries.sql` once; sqlc generates typed Go functions. No runtime ORM magic; query mistakes are compile errors.
- **`pgx/v5`** as the underlying driver (sqlc's preferred backend, supports pgvector via `pgx-pgvector`).
- **`mark3labs/mcp-go`** for the MCP server (community-standard Go MCP SDK with streamable HTTP transport).
- **`goose`** for SQL migrations — plain `*.sql` files with `up`/`down`, run on startup.
- **`golang.org/x/crypto/argon2`** for password hashing (Argon2id).
- **`redis/go-redis/v9`** for sessions / queues / rate limiting.
- **`anthropic-sdk-go`** + **OpenAI Go SDK** for code-tier inference (BYOAI inference never reaches us; see D.2).

#### Edge / infra

- **Caddy 2** for reverse proxy + automatic Let's Encrypt + on-demand TLS for custom domains.
- **pgvector** for embedding storage and ANN search. Avoids an external vector DB.

#### Frontend

- **shadcn/ui** (heavily themed) as the primitive layer for admin (Dialog, Combobox, Tooltip, Tabs, Toggle). Public surfaces (`index`, `gate`) hand-built — they're the brand.
- **tsup** for SDK packaging.

### SDK shape

Three packages in a small monorepo (`sdk/`, pnpm workspace):

```
sdk/
├─ packages/
│  ├─ core/    @standmeet/sdk-core   -- API client + types + state machine (no UI)
│  ├─ react/   @standmeet/sdk         -- React components + hooks, depends on core
│  └─ embed/   @standmeet/embed       -- Web Components wrapper, depends on react
```

Built artifacts ship from npm AND served from each instance under `/sdk/v1/...` so a self-hoster can drop a `<script>` pointing at their own instance.

### Why this shape

- Go binary deploys as a single static file in a `FROM scratch` container (~20 MB image); compared to a Python image (~150 MB + uvicorn workers), self-host footprint shrinks ~7×.
- sqlc + DDD reads cleanly: SQL queries live in `db/queries/*.sql`, generated code in `internal/infra/db/`, business logic in `internal/app/`. No ORM-shaped surprises.
- Core split lets future framework adapters (Vue, Svelte) reuse the protocol layer.
- Embed re-rendering React under a Web Component adds ~40 kB gzip, avoiding two completely separate UI codebases.

### Decision points

**B.1** shadcn/ui adoption. Saves time on a11y primitives but adds a dependency. **Recommend:** yes for admin only.

**B.2** pgvector over external (Pinecone/Qdrant). Better for self-host, sufficient up to ~1M entries. **Recommend:** pgvector.

**B.3** SDK packaging. React-first with embed as React renderer wrapped in Web Component, vs two separate code paths. **Recommend:** React-first + embed wraps it.

**B.4** Whether `@standmeet/sdk` ships from npm AND from instance. **Recommend:** both — npm for cross-instance usage, instance-served as the default `<script>` source in admin's MCP setup snippets.

**B.5** Migrations: `goose` (plain `*.sql`, light) vs `atlas` (HCL/SQL declarative, paired with linting). **Recommend:** goose — owner-deploy simplicity outweighs atlas's schema-drift detection at this scale.

**B.6** Async queue: `asynq` (Redis, simple) vs `river` (Postgres-backed, single dependency). **Recommend:** start without one — pure goroutines with a Redis list — and pick `asynq` if/when we outgrow that.

---

## I. Repository structure

(Listed before C/D/E because it informs where the schemas / endpoints live.)

```
standmeet/
├─ CLAUDE.md
├─ README.md
├─ Makefile
├─ docker-compose.yml          ← prod-ish, used by install.sh
├─ docker-compose.dev.yml      ← dev with hot reload, volumes mounted from host
├─ Caddyfile
├─ .env.example
├─ install.sh                  ← one-line self-host installer
│
├─ backend/                    ← new Go server (chi + sqlc + mcp-go)
│  ├─ go.mod / go.sum
│  ├─ Dockerfile               ← multi-stage: build → distroless scratch-ish final
│  ├─ entrypoint.sh            ← runs migrations, then server
│  ├─ sqlc.yaml
│  ├─ cmd/
│  │  └─ server/main.go        ← composes everything, starts HTTP
│  ├─ internal/
│  │  ├─ domain/               ← entities, value objects, repository interfaces (pure Go, no infra import)
│  │  ├─ app/                  ← use cases (e.g. PromoteRawToWiki, IssueCodeSession)
│  │  ├─ infra/
│  │  │  ├─ db/                ← sqlc generated + Repository implementations
│  │  │  ├─ storage/           ← media driver (local fs / s3)
│  │  │  ├─ sandbox/           ← spawn-per-build helper (docker run wrapper)
│  │  │  └─ inference/         ← anthropic + openai clients
│  │  ├─ interfaces/
│  │  │  ├─ admin_api/         ← chi routes for /api/admin/* (session auth)
│  │  │  ├─ public_api/        ← chi routes for /api/v1/* (visitor session-token auth, CORS-open)
│  │  │  ├─ mcp_server/        ← mcp-go: tools, prompts, resources
│  │  │  └─ internal_api/      ← /internal/healthz, /internal/tls-ask, /internal/log
│  │  └─ auth/                 ← session manager, api-token verifier, claim flow
│  ├─ db/
│  │  ├─ migrations/           ← *.sql for goose
│  │  ├─ schema.sql            ← canonical schema (sqlc input)
│  │  └─ queries/              ← *.sql, one file per aggregate (raw.sql, wiki.sql, codes.sql, …)
│  └─ tests/                   ← integration tests (testcontainers PG + Redis)
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
│     │  └─ (admin)/admin/[[...slug]]/page.tsx   ← surface: admin (SPA-ish)
│     ├─ components/                              ← shared, themed
│     ├─ lib/
│     │  ├─ api/                                  ← typed admin + public clients
│     │  ├─ auth/                                 ← session helpers
│     │  └─ design/                               ← Newsreader/Mono setup, color tokens, motion
│     └─ styles/globals.css
│
├─ sdk/                        ← npm packages
│  ├─ pnpm-workspace.yaml
│  └─ packages/
│     ├─ core/                 ← @standmeet/sdk-core
│     ├─ react/                ← @standmeet/sdk
│     └─ embed/                ← @standmeet/embed
│
├─ builder/                    ← per-build sandbox image
│  ├─ Dockerfile               ← node + vite + a thin runner
│  ├─ runner.mjs               ← reads source files from stdin/volume, writes dist/
│  └─ template/                ← starter App.tsx using @standmeet/sdk
│
├─ infra/
│  ├─ caddy/                   ← Caddyfile fragments, ask endpoint helper
│  └─ scripts/                 ← install.sh, backup.sh, restore.sh
│
├─ e2e/                        ← Playwright covering full stack
│  ├─ package.json
│  ├─ playwright.config.ts
│  └─ tests/
│
├─ docs/
│  ├─ design/                  ← prototype handoff (canonical visuals) + this file
│  └─ <legacy *.md>            ← old vision/distillation, kept as reference
│
├─ standmeet-client/           ← legacy reference (Electron)
├─ standmeet-e2e/              ← legacy reference (Playwright)
└─ standmeet-server/           ← legacy reference (old Django monorepo server)
```

### Decision points

**I.1** Top-level `pnpm-workspace.yaml` covering `app/`, `sdk/`, and `e2e/` so types and a single lockfile are shared. Backend stays Go-module-managed and out of pnpm. **Recommend:** yes.

**I.2** `admin` route group (`/admin/*` on same host) vs separate hostname. **Recommend:** route group — owner CNAMEs one domain, admin lives at `/admin` on it. Less DNS/SSL surface.

**I.3** `builder/` at root, not under `backend/`. **Recommend:** root — it's a distinct runtime image with its own dependency tree; co-locating it under backend would confuse the boundary.

**I.4** Inside `backend/internal/`, DDD layering (`domain/app/infra/interfaces`) vs Go-idiomatic feature packages (`internal/corpus`, `internal/codes`, …). **Recommend:** DDD — the layering matches how we already reason about the domain in legacy code; cross-cutting concerns (auth, owner_id) live in clear places.

---

## C. Data model

All tables include `owner_id uuid not null`, indexed. Single-owner v1 always uses the same value; multi-tenant flips on later with no migration.

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

instance_settings                                  -- singleton (id=1)
  is_claimed           bool default false
  setup_token_hash     text null                  -- one-shot, sha256(plaintext); printed plaintext to stdout
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
  id              uuid pk
  owner_id        uuid fk
  title           text
  body            text
  tags            text[]
  visibility      text                            -- 'public' | 'on_request' | 'private'
  source_raw_ids  uuid[]
  embedding       vector(1536) null
  embedded_at     timestamptz null
  created_at      timestamptz
  updated_at      timestamptz

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
  purpose             text                        -- free text, owner-only
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
  is_anonymous        bool                        -- joined as 'someone new'
  last_seen_at        timestamptz null
```

### Visitor sessions

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
  updated_at          timestamptz
```

### Custom pages (MCP-authored, 3-stage publish)

```
custom_pages
  id                  uuid pk
  owner_id            uuid fk
  slug                text                        -- '' = root (overrides default index); '/blog', '/work', …
  packages            jsonb                       -- allow-listed npm deps (server validates against allowlist)
  draft_files         jsonb                       -- {path: contents}; live state being written via MCP
  staging_build_id    uuid null fk -> custom_page_builds
  live_build_id       uuid null fk -> custom_page_builds
  staging_url_token   text null                   -- unguessable token; staging URL = host/_stage/{token}/...
  staged_at           timestamptz null
  live_at             timestamptz null
  created_at          timestamptz
  unique(owner_id, slug)

custom_page_builds                                 -- immutable artifact records
  id                  uuid pk
  page_id             uuid fk -> custom_pages
  status              text                        -- 'building' | 'built' | 'failed'
  build_log           text                        -- truncated to 64 KB
  output_path         text null                   -- 'custom/{owner_id}/{build_id}/'
  source_snapshot     jsonb                       -- files as built (for rollback / audit)
  packages_snapshot   jsonb
  started_at          timestamptz
  finished_at         timestamptz null
  error               text null
```

The three publish states (`draft` / `staging` / `live`) are derived columns:

- **draft** — `draft_files` non-empty since last build.
- **staging** — `staging_build_id` non-null, points at a `built` build, served at `/_stage/{staging_url_token}/`.
- **live** — `live_build_id` non-null, served at the owner's public path (`/{slug}`).

Promotion = "copy the chosen build_id into the target field." Rollback = "set `live_build_id` to a previous build." History never gets deleted — it's an audit trail and a safety net.

### API tokens / connectors

```
api_tokens
  id              uuid pk
  owner_id        uuid fk
  name            text
  token_hash      text unique                     -- sha256(plaintext); plaintext shown once
  token_prefix    text                            -- 'smk_abc…' (first 8 chars for UI)
  scopes          text[]                          -- 'mcp:write', 'mcp:read', 'mcp:pages'
  last_used_at    timestamptz null
  usage_count     integer default 0
  revoked_at      timestamptz null
  created_at      timestamptz

connectors
  id              uuid pk
  owner_id        uuid fk
  kind            text                            -- 'email' | 'calendar'
  provider        text                            -- 'google' | 'outlook'
  enabled         bool
  oauth_token     bytea null                      -- encrypted at rest (AES-GCM with key from env)
  oauth_refresh   bytea null
  meta            jsonb
```

### Indexes (non-PK)

- `owners(email)` unique, `owners(handle)` unique, `owners(custom_domain)` unique partial where not null
- `raw_entries(owner_id, created_at desc)`, `raw_entries(owner_id, archived) where archived=false`
- `wiki_entries(owner_id, visibility)`, `wiki_entries USING ivfflat (embedding vector_cosine_ops)`
- `access_codes(code)` unique, `access_codes(owner_id, status)`
- `messages(conversation_id, created_at)`
- `api_tokens(token_hash)` unique
- `custom_pages(owner_id, slug)` unique
- `custom_page_builds(page_id, started_at desc)`

### Decision points

**C.1** Embedding sync timing. Synchronous on write vs async via queue. **Recommend:** async — `promote_to_wiki` returns immediately; retrieval falls back to lexical search until `embedded_at` is set.

**C.2** `page_content` as JSONB vs relational. JSONB matches the way admin edits whole blocks. **Recommend:** JSONB; one row per owner; if a field becomes search-critical later, denormalize a column.

**C.3** Media storage. Local filesystem (volume mounted) vs S3-compatible. **Recommend:** local default with pluggable backend driver — `storage_key` works for both; install.sh sets `STORAGE_DRIVER=local`.

**C.4** Tag taxonomy. Free text `text[]` vs a `tags` table with FK relations. **Recommend:** free text; if owner tags get messy, add `tag_aliases` later.

**C.5** Owner-id enforcement layer. In Go we don't have a Manager pattern; the equivalent is wrapping sqlc's generated queries inside a **Repository** that takes `ownerID` as the first arg and never exposes raw queries. A linter (custom go-analysis vet check) flags any call to a sqlc function that doesn't go through the Repository. **Recommend:** Repository pattern + vet check. Postgres RLS as a v2 hardening if multi-tenant becomes real.

**C.6** Custom-page allowlisted packages. The build sandbox must not let an owner's AI npm-install arbitrary code. Maintain an allowlist (`react`, `framer-motion`, `lucide-react`, `clsx`, `@standmeet/sdk`, …) checked server-side before invoking the builder. **Recommend:** start with ~15 well-known packages; expand on request.

**C.7** Build retention. Old `custom_page_builds` accumulate. **Recommend:** keep last 20 per page + last `live_build_id` forever + 30-day prune of others.

---

## D. API design

Three separate API surfaces. Each has its own auth, schema, and audience. Same Go binary, different chi sub-routers.

### D.1 Admin REST API — `/api/admin/*`

- **Audience:** owner's browser (admin Next.js surface).
- **Auth:** session cookie + CSRF for state-changing requests.
- **CORS:** same-origin only (admin is on instance domain).

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
DELETE /api/admin/codes/:id                 -- revoke (soft)
POST   /api/admin/codes/:id/members
DELETE /api/admin/codes/:id/members/:mid

GET    /api/admin/conversations             ?code_id=&tier=
GET    /api/admin/conversations/:id

GET    /api/admin/page
PUT    /api/admin/page                      -- replace default-page blocks atomically

POST   /api/admin/media                     -- multipart upload (admin manual)
GET    /api/admin/media                     ?attached_to=
DELETE /api/admin/media/:id

GET    /api/admin/tokens
POST   /api/admin/tokens                    -- response includes plaintext ONCE
DELETE /api/admin/tokens/:id

GET    /api/admin/connectors
POST   /api/admin/connectors/:kind/oauth/start    -> {redirect_url}
GET    /api/admin/connectors/:kind/oauth/callback

# Custom pages — monitoring & lifecycle only. NO source-file CRUD here.
GET    /api/admin/custom-pages              -- list with derived state (draft/staging/live)
GET    /api/admin/custom-pages/:id
GET    /api/admin/custom-pages/:id/builds   -- recent build history
POST   /api/admin/custom-pages/:id/publish  {build_id} -- promote a built build to live
POST   /api/admin/custom-pages/:id/rollback              -- previous live_build_id
POST   /api/admin/custom-pages/:id/unpublish             -- live_build_id := null
DELETE /api/admin/custom-pages/:id
```

Source-file authoring lives in MCP, not here (see D.3).

### D.2 Public API — `/api/v1/*`

- **Audience:** SDK clients (instance's own Next.js public pages + any third-party site embedding the SDK).
- **Auth:** Bearer session token issued by `POST /api/v1/sessions`. Opaque, Redis-backed, 60-min TTL with sliding refresh up to 8 h.
- **CORS:** open on read; restricted on write (only sessions endpoints).

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
  events: token deltas, tool_call_start, tool_call_end, citation, done, error

GET    /api/v1/page/:handle                -- default page content (read-only)
GET    /api/v1/page/:handle/byoai-config   -- {enabled, providers, public_blurb}
GET    /api/v1/sdk/v1/manifest             -- SDK build metadata (for instance-served <script>)
```

### D.3 MCP server — `/mcp/`

- **Audience:** owner's AI client (Claude Desktop, Cursor, …).
- **Auth:** `Authorization: Bearer smk_…`.
- **Protocol:** `mcp-go` streamable HTTP transport.

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

**Tools — custom pages (the entire authoring surface):**

```
# Lifecycle
custom_page.list()
  -> [{id, slug, has_draft, staging_url?, live_url?, last_build}]
custom_page.create(slug, template?='blank')
  -> {page_id}
custom_page.delete(page_id)

# File editing — AI calls these to write the React source
custom_page.list_files(page_id)
  -> [{path, size}]
custom_page.read_file(page_id, path)
  -> {contents}
custom_page.write_file(page_id, path, contents)
custom_page.delete_file(page_id, path)
custom_page.set_packages(page_id, deps)
  -- deps validated against server allowlist (see C.6)

# Build & promote
custom_page.build(page_id)
  -> {build_id}                                     -- async; spawns builder container
custom_page.get_build(page_id, build_id?)
  -> {status, log, finished_at, error?}             -- omit build_id = latest
custom_page.promote_to_staging(page_id, build_id?)
  -> {staging_url}                                  -- unguessable token URL
custom_page.promote_to_live(page_id, build_id?)
  -> {live_url}
custom_page.rollback(page_id)
  -- live_build_id := previous live build
```

Owner's typical flow:

> Owner (in Claude Desktop): "Add a `/blog` page that pulls my 5 most recent public wiki entries into the hero."
> AI: calls `custom_page.create('/blog')` → `search_wiki(visibility='public', limit=5)` → several `write_file()` → `build()` → polls `get_build()` until built → `promote_to_staging()` → reads back the staging URL.
> Owner: opens URL, "the hero text is too small, double it."
> AI: `write_file()` + `build()` + new staging URL.
> Owner: "Ship it."
> AI: `promote_to_live('/blog')`.

The admin's "Custom pages" section is the monitoring panel for everything above — list of pages, derived state, staging/live URLs, manual `publish` / `rollback` / `unpublish` / `delete` buttons. No editor, no chat, no preview iframe.

### D.4 Internal endpoints — `/internal/*`

- `/internal/healthz` — for Caddy probe + uptime.
- `/internal/tls-ask?domain=…` — Caddy on-demand TLS gatekeeper. Returns 200 iff the domain matches an owner's `custom_domain_status='verified'`.
- `/internal/log` — frontend error report sink (rate-limited).

### Decision points

**D.1** SSE vs WebSocket for the chat stream. SSE is HTTP, plays nice with CORS / proxies / browsers; we lose bi-directional, which we don't need. **Recommend:** SSE.

**D.2** BYOAI key path. Visitor's API key should never reach our server. Flow: server returns RAG context + filtered scope; SDK runs the inference call directly against `api.anthropic.com` / `api.openai.com` using visitor's key. Server proxy alternative is simpler but stores liability. **Recommend:** client-side direct, two-step (RAG → infer).

**D.3** MCP auth — API token now, OAuth flow later. Owner builds a token in admin, pastes the JSON snippet into Claude Desktop. Friction, but bulletproof v0. **Recommend:** API tokens for v1, add OAuth provider in v2.

**D.4** Session token storage. Server-side opaque (Redis lookup, revocable) vs JWT. Owners revoking codes need instant effect. **Recommend:** opaque + Redis.

**D.5** Idempotency on `raw_dump`. AI may retry on transient failures and double-write. **Recommend:** require `request_id` (uuid) header on MCP writes, server dedupes within a 1-hour window.

**D.6** Custom-page write idempotency. `write_file` is naturally idempotent (file content replaces). `build` is more subtle — concurrent builds for the same page should be coalesced (return the in-flight `build_id`) rather than queued. **Recommend:** coalesce; one in-flight build per page.

---

## E. Auth

Five auth scenarios:

| Scenario | Surface | Mechanism |
|---|---|---|
| First-run instance claim | `/setup?t=<token>` | one-shot `setup_token` printed to console |
| Owner login | `/login` | email + password → session cookie |
| MCP client | `/mcp/*` | `Authorization: Bearer smk_…` (API token) |
| Visitor code access | `/api/v1/sessions` | code → opaque session token |
| Visitor BYOAI access | `/api/v1/sessions` | `byoai: true` → opaque session token (public-scope) |

### First-run claim flow

1. Container starts. `instance_settings.is_claimed=false`. Backend generates a one-shot `setup_token`, stores `sha256(token)` in `instance_settings.setup_token_hash`, and prints plaintext to stdout:
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │ STANDMEET is ready. Claim this instance:                    │
   │   https://your-domain.example/setup?t=eyJh…                 │
   └─────────────────────────────────────────────────────────────┘
   ```
   Also writes the URL to `/srv/first-run.txt` (deleted after claim) for users not watching logs.
2. Owner opens link → setup page → fills email/password/handle/full_name → `POST /api/admin/claim {token, …}`.
3. Backend verifies token, creates owner, marks `is_claimed=true`, clears `setup_token_hash`, deletes the file. Endpoint refuses subsequent calls.
4. Owner is auto-logged-in.

### Owner-id propagation

- A chi middleware (`auth.WithOwner`) runs early on every authenticated route. Reads session cookie / bearer token / visitor session token (whichever applies) → resolves `owner_id` → puts it on `context.Context` via a typed key.
- Repository methods take `ctx context.Context` first; they pull `owner_id` from context and refuse to run if absent.
- Custom vet check (`cmd/lint/owneridvet`) flags any sqlc-generated call made outside a Repository method, so we can't accidentally bypass the filter.

### Sessions in detail

- Owner cookie name `smt_session`, HttpOnly, Secure, SameSite=Lax, Path=/api/admin.
- Backed by Redis: `session:{token}` → `{owner_id, expires_at, csrf_token}`.
- CSRF: double-submit cookie pattern; frontend bootstraps via `GET /api/admin/csrf`.

### Visitor session token

- Opaque random 32 bytes, base64url, prefixed `smv_`.
- Redis: `vsession:{token}` → `{owner_id, code_id?, member_id?, scope, byoai?, expires_at}`.
- TTL 60 min, slides on each request up to 8 h max.

### API tokens

- Plaintext format `smk_<24-char-base32>`. Backend stores `sha256(plaintext)` only.
- Created via admin; the only place plaintext is ever shown.
- Revocation: `revoked_at` set → middleware rejects.
- Scopes: `mcp:read`, `mcp:write` (raw / wiki / media / tags), `mcp:pages` (custom page tools).

### Decision points

**E.1** Setup token delivery. Console print + host file. **Recommend:** both.

**E.2** Password hashing. Argon2id via `golang.org/x/crypto/argon2`. **Recommend:** Argon2id with `time=3, memory=64 MB, threads=4` defaults.

**E.3** CSRF model. Double-submit cookie + `X-CSRFToken` header on mutating admin calls. **Recommend:** standard, served via `/api/admin/csrf` on bootstrap.

**E.4** API token scopes. Coarse v1 (`mcp:read`, `mcp:write`, `mcp:pages`) with field reserved for granular later. **Recommend:** coarse — owner doesn't want to manage 8 scopes for their own AI.

**E.5** Cross-origin admin. **Recommend:** disallow in v1; admin lives at `/admin` on the same host as public.

---

## F. Multi-tenant readiness

The shape: v1 wires single-owner everywhere but the *data* and *URL surface* are tenancy-shaped already.

### Data layer

- Every domain table has `owner_id`.
- Repository methods require `ownerID` from `context.Context`; no method exposes an "all owners" view.
- Storage paths prefixed `{owner_id}/…`.
- Page-builder output paths prefixed `custom/{owner_id}/{build_id}/…`.

### URL layer (v1 vs v2)

| Surface | v1 (single-owner) | v2 (multi-tenant) |
|---|---|---|
| Public chat | `/` → rewritten to `/{owner_handle}` by middleware | `/{handle}` |
| Gate | `/gate` → `/{handle}/gate` | `/{handle}/gate` |
| Admin | `/admin` (owner login required) | `/admin` (owner login required, scoped) |
| Login | `/login` | `/login` |
| Setup | `/setup?t=` | replaced by `/signup` |
| Custom page | `/{slug}` → `/{owner_handle}/{slug}` | `/{handle}/{slug}` |
| Staging custom page | `/_stage/{token}/...` (token contains owner_id) | unchanged |

v1 middleware folds `/` → `/{owner_handle}` for the only owner; v2 unmounts the middleware and serves `/[handle]` directly. Less code churn at the flip.

### Flag

`instance_settings.multi_tenant: bool`. Controls:
- whether `/setup` is reachable after first claim
- whether `/signup` is reachable
- whether `POST /api/admin/claim` is reachable for additional owners

### Decision points

**F.1** Hostname strategy at v2: `/{handle}` paths vs `{handle}.domain` subdomains. Subdomain feels more "personal page" but adds wildcard SSL + DNS. **Recommend:** plan for both; v1 path-based; v2 toggleable with `multi_tenant_url_style ∈ {path, subdomain}`.

**F.2** Custom domain ownership. In multi-tenant, the same instance hosts many custom domains. Caddy on-demand TLS asks `/internal/tls-ask?domain=…`. **Recommend:** already covered by the data model.

**F.3** Storage isolation. Local filesystem with `{owner_id}/...` paths is a soft barrier for v1. **Recommend:** accept the soft barrier; document hardening (per-owner UID, quota) as a v2 task.

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
      - custom_pages:/srv/custom:ro
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
      - SESSION_KEY                              # for cookie signing
      - STORAGE_DRIVER=local
      - STORAGE_ROOT=/srv/media
      - BUILDER_IMAGE=standmeet/builder:latest
      - DOCKER_HOST=unix:///var/run/docker.sock  # to spawn builder containers
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - media:/srv/media
      - custom_pages:/srv/custom
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
  custom_pages: {}
```

The `builder` service is NOT in compose — backend spawns it with the Docker socket per `custom_page.build()`.

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

Migrations run on startup (`goose up`) from `/migrations`. Final image ~25 MB, no shell, no package manager. Runs as nonroot.

### Caddyfile (sketch)

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
  handle_path /_stage/*    { reverse_proxy backend:8000 }   # backend serves staging by token
  reverse_proxy app:3000
}

:443 {
  tls { on_demand }
  @custom not host {$STANDMEET_DOMAIN}
  reverse_proxy @custom app:3000
}
```

### Install script (`install.sh`)

```sh
#!/bin/sh
# 1. Check docker & docker compose available
# 2. Clone repo OR download release tarball
# 3. Prompt for STANDMEET_DOMAIN, STANDMEET_EMAIL
# 4. Generate .env with random SESSION_KEY + DB_PASSWORD
# 5. docker compose pull && docker compose up -d
# 6. Tail backend logs until "STANDMEET is ready" banner, print setup URL
```

### Migrations

Backend entrypoint runs `goose up` against the connection string before starting the HTTP server. Breaking migrations flagged in release notes; major version bumps documented in `MIGRATION.md`.

### Backup / restore

- `make backup` → `pg_dump` + `tar` of `media/` + `custom_pages/` → single dated tarball.
- `make restore TARBALL=…` → restores into fresh volumes.
- v1: no automatic schedule; document a cron one-liner.

### Decision points

**G.1** On-demand TLS rate limiting via the ask endpoint. **Recommend:** ask endpoint checks `custom_domain_status='verified'`.

**G.2** Zero-downtime upgrades. **Recommend:** not in v1; accept 5–10s downtime on `docker compose up`.

**G.3** Migration runner. Auto-`goose up` on startup vs explicit `make migrate`. **Recommend:** auto with a `MIGRATE_ON_START=false` escape hatch.

**G.4** Builder isolation level. `docker run --rm` with `--network=none` + drop-capabilities + read-only root + tmpfs `/tmp` + seccomp profile + memory/cpu limits + 60s timeout. Tighter would be gVisor/Firecracker. **Recommend:** docker run with the listed hardening for v1; document a path to gVisor.

**G.5** Backend container needs Docker socket access to spawn builders. That's a privilege escalation if the backend is compromised. Alternatives: rootless Podman, or run a thin `builder-broker` daemon. **Recommend:** socket access for v1 (acceptable given backend is the trust boundary anyway); v2 evaluate `builder-broker`.

---

## H. Observability and error handling

### Logging

- **Backend:** structured JSON to stdout via `slog`. Fields: `ts, level, owner_id?, request_id, route, msg`.
- **Frontend:** errors posted to `/internal/log` (rate-limited).
- **Caddy:** JSON access log.
- **Builder:** stdout captured into `custom_page_builds.build_log`; owner reads via `custom_page.get_build()` MCP tool or admin list view.

### Health checks

- `GET /internal/healthz` → 200 if PG + Redis reachable.
- Caddy waits on this before routing.

### User-facing errors (preserved from CLAUDE.md)

Standard envelope:

```json
{ "error": { "code": "tier_insufficient", "message": "...", "hint": "..." } }
```

Frontend has a single `friendlyError(code)` helper that maps codes to displayable copy. Default fallback `"Something went wrong"` — never a stack trace, never an exit code, never a Go panic string.

| code | meaning | UI shows |
|---|---|---|
| `code_invalid` | access code unknown / revoked | "That code didn't work. Double-check it or request access." |
| `code_expired` | access code past expiry | "This code has expired. Request a new one." |
| `tier_insufficient` | private content in public/byoai tier | inline "public scope only · need a code" block |
| `byoai_disabled` | owner toggled off | "BYOAI isn't enabled on this page. Use an access code instead." |
| `ratelimited` | too many requests | "Slow down — try again in a minute." |
| `not_found` | bad handle / 404 | standard 404 page |
| `build_failed` | sandbox build error (custom page) | admin shows truncated log inline |
| `package_not_allowed` | custom page tried a non-allowlisted npm dep | admin shows which package + how to request |
| `server_error` | catch-all | "Something went wrong." (+ request_id) |

### Metrics

- v1: structured logs, ad-hoc query.
- v2: Prometheus exporter behind `/internal/metrics`, basic-auth.

### Decision points

**H.1** Telemetry. **Recommend:** no for v1; self-host crowd values privacy.

**H.2** Frontend error reporter. **Recommend:** self-hosted; v2 makes Sentry DSN configurable.

**H.3** Request ID propagation. Caddy generates → forwarded as `X-Request-ID` to backend → echoed on error envelopes. **Recommend:** yes.

**H.4** Build log size cap. **Recommend:** truncate at 64 KB with `(truncated)` marker.

---

## Cross-cutting principles

1. **owner_id is non-negotiable.** Every domain table, every query, every storage path. Repository methods take it from `ctx`; vet check enforces.
2. **Three API surfaces, three auth mechanisms, one process.** Don't merge admin and public API endpoints "for convenience."
3. **The SDK is a first-class consumer of the public API.** If something is hard to expose to the SDK, the API is wrong.
4. **MCP is the owner's authoring channel, not just an ingest channel.** Any owner-side workflow that benefits from being AI-driven (raw → wiki, building custom pages, tagging, future: ghostwriting, replying) is shaped as a tool set, not an admin UI feature. Admin UI is for monitoring and explicit safety controls (publish, rollback, revoke).
5. **Self-host friendliness > feature richness.** Anything that needs an external SaaS account is a v2 concern.
6. **Errors are UI copy.** Backend codes are stable; frontend strings are localized; never leak.

---

## Open questions outside this doc's scope

These are surfaced as known unknowns. Decide in a follow-up:

- **Inference cost for code-tier conversations** — owner pays via configured API key (Anthropic/OpenAI) stored as `connector` or env var? Schema accommodates either; UX in admin not designed yet.
- **IM bridge (Telegram/Discord/Slack)** — out of scope for first slice. Data model is already accommodating (`raw_entries.source='telegram-bot'`; access-code session via bot DM).
- **Electron client** — same. Ingest channel already supported; UX out of scope.
- **Connectors (Email / Calendar)** — schema present; tool-call rendering in chat (`tool_calls jsonb`) supports calendar slot proposals; OAuth flow design deferred.
- **Allowlist governance for custom-page packages** — who decides what's on it, how owners request additions, whether the allowlist itself is a versioned config file.

---

*End of code architecture draft. Reply with decision-point acceptances or changes (e.g. "A.1: accept; B.1: change — no shadcn, hand-build everything").*
