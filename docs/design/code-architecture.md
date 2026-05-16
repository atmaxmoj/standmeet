# StandMeet Code Architecture

> **Status:** Draft for owner review (2026-05-16).
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
   │ Next.js │  │  Django  │         │ static     │
   │ :3000   │  │  +DRF    │         │ (volume)   │
   └─────────┘  │  +MCP    │         └────────────┘
                │  :8000   │
                └────┬─────┘
            ┌────────┼─────────┐
       ┌────▼──┐ ┌───▼────┐ ┌──▼──────┐
       │  PG   │ │ Redis  │ │ Builder │
       │ pgvec │ │        │ │ sandbox │
       └───────┘ └────────┘ │ (on demand) │
                            └─────────────┘
```

5 long-running containers (caddy / app / backend / pg / redis) + 1 on-demand container (builder). Single docker compose. Self-hosted, single command to start.

---

## A. System topology

### Constraints

- One command brings up the whole stack (`docker compose up -d`).
- Automatic SSL for the instance's own domain and for owner custom domains.
- Single owner v1; multi-tenant in the data layer.
- SDK runs in third-party browsers — API must be CORS-safe.
- MCP server reachable by owner's AI clients over HTTPS.
- Page-builder sandbox needs to execute owner-provided code safely (bwrap / firejail / VM).

### Recommended shape

Five long-running services:

1. **`caddy`** — reverse proxy, TLS terminator, on-demand TLS for custom domains.
2. **`app`** — Next.js 15. Renders 4 surfaces (`index` / `gate` / `admin` / `login`). Talks to backend over HTTP.
3. **`backend`** — Django + DRF + FastMCP, ASGI under uvicorn. Exposes 3 logical API namespaces (admin / public-v1 / mcp) on the same port.
4. **`db`** — PostgreSQL 16 with pgvector.
5. **`redis`** — sessions, queues, rate limits.

One on-demand service:

6. **`builder`** — sandboxed container started per custom-page build, writes static output to a shared volume, exits.

Optional / later:

- **`worker`** — separate ASGI/Huey/RQ process for async work (embedding computation, email sending). Until proven needed, runs in-process in backend.
- **embedding service** — none; pgvector + a small Python helper in backend handles it.

### Why this shape

- Three responsibilities (proxy / web / API) are independently scaled and reasoned about. More containers = more compose lines, but the boundaries match how we'll debug and rebuild.
- Backend as a single process consolidating REST + MCP + RAG keeps the data layer behind one auth surface. We don't want MCP and REST diverging on what an "access code" is.
- Builder isolated from backend because owner-supplied code is untrusted.

### Decision points

**A.1** SSR strategy. Public pages (`/[handle]`, `/[handle]/gate`) are SEO-sensitive → SSR. Admin is auth-gated → CSR (simpler, smaller bundle). **Recommend:** mixed, public SSR, admin CSR.

**A.2** MCP server placement. In-process with backend (current pattern) or separate container. **Recommend:** in-process — they share the same auth (API tokens) and ORM, and FastMCP under ASGI is straightforward.

**A.3** Builder lifecycle. Long-running build server (current) vs spawn-per-build. **Recommend:** spawn-per-build via `docker run` (or k8s job equivalent), invoked from backend. Most owners rebuild rarely; idle build server wastes RAM and is an attack surface.

**A.4** Async work. In-process (Django + Huey threaded) vs separate worker. **Recommend:** in-process Huey for v1; promote to separate container if/when corpus-embedding queues bloat.

---

## B. Tech choices

### Keep from legacy

- **Django + DRF.** DDD layering in `standmeet-server/backend/` is sound; ORM is enough; FastMCP already integrates. No reason to switch.
- **PostgreSQL.** Add pgvector extension.
- **Next.js 15 + React 19 + Tailwind 4.** Design prototype is already Tailwind; trivial port.
- **uv** for Python dependency management.
- **TypeScript** everywhere on the frontend / SDK.

### New introductions

- **Caddy 2** for reverse proxy + automatic Let's Encrypt + on-demand TLS for custom domains. Picked over Traefik because Caddy's config is one file and on-demand TLS is built in.
- **pgvector** for embedding storage and ANN search. Avoids an external vector DB.
- **shadcn/ui** (heavily themed) as the primitive layer for admin (Dialog, Combobox, Tooltip, Tabs, Toggle). Public surfaces (`index`, `gate`) hand-built — they're the brand.
- **tsup** for SDK packaging (faster than rollup config, simpler than vite-lib).
- **Anthropic SDK / OpenAI SDK** server-side for code-tier RAG inference.

### SDK shape

Three packages in a small monorepo (`sdk/`, pnpm workspace):

```
sdk/
├─ packages/
│  ├─ core/    @standmeet/sdk-core    -- API client + types + state machine (no UI)
│  ├─ react/   @standmeet/sdk         -- React components + hooks, depends on core
│  └─ embed/   @standmeet/embed       -- Web Components wrapper, depends on react (re-renders React internally) — single <script src=…> drop-in
```

Built artifacts ship from npm AND served from each instance under `/sdk/v1/...` so a self-hoster can drop a `<script>` pointing at their own instance.

### Why this shape

- Core split lets future framework adapters (Vue, Svelte) reuse the protocol layer.
- Embed re-rendering React under a Web Component is a small bundle hit (~40 kB gzip extra), but avoids maintaining two completely separate UI codebases.

### Decision points

**B.1** shadcn/ui adoption. Saves time on a11y primitives but adds a dependency. **Recommend:** yes for admin only.

**B.2** pgvector over external (Pinecone/Qdrant). Better for self-host, sufficient up to ~1M entries. **Recommend:** pgvector.

**B.3** SDK packaging. React-first with embed as React renderer wrapped in Web Component, vs two separate code paths. **Recommend:** React-first + embed wraps it.

**B.4** Whether `@standmeet/sdk` ships from npm AND from instance. **Recommend:** both — npm for cross-instance usage, instance-served as the default `<script>` source in admin's MCP setup snippets.

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
├─ backend/                    ← new Django + DRF + FastMCP
│  ├─ pyproject.toml
│  ├─ Dockerfile
│  ├─ entrypoint.sh
│  ├─ manage.py
│  ├─ standmeet/               ← Django settings + ASGI
│  ├─ domain/                  ← entities, value objects, interfaces (DDD)
│  ├─ application/             ← use-case services (e.g. PromoteRawToWikiService)
│  ├─ infrastructure/          ← ORM, storage, external integrations (Anthropic, etc.)
│  ├─ interfaces/
│  │  ├─ admin_api/            ← DRF, session auth (/api/admin/*)
│  │  ├─ public_api/           ← DRF, session-token auth (/api/v1/*)
│  │  ├─ mcp_server/           ← FastMCP, API token auth (/mcp/*)
│  │  └─ internal/             ← Caddy ask endpoint, healthz, internal log
│  └─ tests/
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
├─ builder/                    ← sandboxed page-builder, spawned per build
│  ├─ Dockerfile
│  ├─ build.mjs
│  ├─ template/                ← starter App.tsx using @standmeet/sdk
│  └─ runtime/                 ← sandbox wrapper (bwrap or VM)
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
│  ├─ design/                  ← prototype handoff (canonical visuals)
│  ├─ code-architecture.md     ← this file
│  └─ <legacy *.md>            ← old vision/distillation, kept as reference
│
├─ standmeet-client/           ← legacy reference (Electron)
├─ standmeet-e2e/              ← legacy reference (Playwright)
└─ standmeet-server/           ← legacy reference (old monorepo server)
```

### Decision points

**I.1** Whether to grow a top-level `pnpm-workspace.yaml` covering `app/`, `sdk/`, and `e2e/` so types and a single lockfile can be shared. **Recommend:** yes, with workspaces declared at root; backend stays uv-managed and out of pnpm.

**I.2** `admin` route group vs separate hostname. **Recommend:** route group (`/admin/*` on same host) — owner CNAMEs one custom domain, admin lives at `/admin` on it. Less DNS/SSL surface.

**I.3** `builder/` lives at the root, not under `backend/`. **Recommend:** root — it's a distinct runtime image with its own dependency tree; co-locating it under backend would confuse the boundary.

---

## C. Data model

All tables include `owner_id uuid not null`, indexed. Single-owner v1 always uses the same value; multi-tenant flips on later with no migration.

### Tenancy / auth

```
owners
  id                  uuid pk
  email               citext unique
  password_hash       text
  handle              citext unique          -- URL slug
  full_name           text
  location            text
  custom_domain       citext unique null
  custom_domain_status text                 -- 'unset' | 'pending' | 'verified'
  byoai_enabled       bool default true
  byoai_providers     jsonb                  -- ['claude','openai']
  byoai_public_blurb  text
  created_at          timestamptz

instance_settings                            -- singleton (id=1)
  is_claimed          bool default false
  setup_token         text null              -- printed to console on first start
  multi_tenant        bool default false
  deployed_at         timestamptz
```

### Corpus

```
raw_entries
  id              uuid pk
  owner_id        uuid fk
  body            text
  source          text                       -- 'mcp:claude-desktop' | 'mcp:cursor' | 'telegram-bot' | 'admin-manual'
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
  visibility      text                       -- 'public' | 'on_request' | 'private'
  source_raw_ids  uuid[]
  embedding       vector(1536) null
  embedded_at     timestamptz null
  created_at      timestamptz
  updated_at      timestamptz

media_assets
  id              uuid pk
  owner_id        uuid fk
  kind            text                       -- 'image' | 'audio' | 'file'
  filename        text
  mime_type       text
  size_bytes      bigint
  storage_key     text                       -- "{owner_id}/{kind}/{uuid}.{ext}"
  raw_entry_id    uuid null fk -> raw_entries
  wiki_entry_id   uuid null fk -> wiki_entries
  created_at      timestamptz
```

### Access control

```
access_codes
  id                  uuid pk
  owner_id            uuid fk
  code                citext unique          -- 'LABEL-XXX'
  label               text                   -- 'OAEN'
  purpose             text                   -- free text, owner-only
  included_tags       text[]                 -- whitelist
  excluded_tags       text[]                 -- redactions
  suggested_questions jsonb                  -- string[]
  expires_at          timestamptz null
  status              text                   -- 'active' | 'revoked' | 'expired'
  created_at          timestamptz

code_members
  id                  uuid pk
  code_id             uuid fk -> access_codes
  display_name        text                   -- 'Alice (HR)'
  email               citext null
  is_anonymous        bool                   -- joined as 'someone new'
  last_seen_at        timestamptz null
```

### Visitor sessions

```
conversations
  id                  uuid pk
  owner_id            uuid fk
  tier                text                   -- 'code' | 'byoai'
  code_id             uuid null fk
  member_id           uuid null fk
  visitor_name        text null              -- BYOAI typed name
  byoai_provider      text null              -- 'claude' | 'openai'
  started_at          timestamptz
  last_at             timestamptz
  message_count       integer default 0
  hit_private         bool default false

messages
  id                  uuid pk
  conversation_id     uuid fk
  role                text                   -- 'visitor' | 'assistant'
  body                text
  tool_calls          jsonb null             -- calendar slots / files / images returned
  cited_wiki_ids      uuid[]
  created_at          timestamptz
```

### Page content + custom pages

```
page_content                                  -- one row per owner
  owner_id            uuid pk fk
  hero_prose          text
  hero_examples       jsonb
  insights            jsonb
  projects            jsonb
  status_block        jsonb
  contact_block       text
  updated_at          timestamptz

custom_pages                                  -- owner-authored React, sandbox-built
  id              uuid pk
  owner_id        uuid fk
  slug            text                        -- '' = root override, '/blog' = sub-path
  source_files    jsonb                       -- {path: contents}
  packages        jsonb                       -- npm deps allow-list
  build_status    text                        -- 'pending'|'building'|'built'|'failed'
  build_log       text null
  output_path     text null                   -- 'custom/{owner_id}/{page_id}/'
  built_at        timestamptz null
  unique(owner_id, slug)
```

### API tokens / connectors

```
api_tokens
  id              uuid pk
  owner_id        uuid fk
  name            text
  token_hash      text unique                 -- sha256(plaintext); plaintext shown once
  token_prefix    text                        -- 'smk_abc…' (first 8 chars for UI)
  scopes          text[]                      -- ['mcp:write','mcp:read']
  last_used_at    timestamptz null
  usage_count     integer default 0
  revoked_at      timestamptz null
  created_at      timestamptz

connectors
  id              uuid pk
  owner_id        uuid fk
  kind            text                        -- 'email' | 'calendar'
  provider        text                        -- 'google' | 'outlook'
  enabled         bool
  oauth_token     bytea null                  -- encrypted at rest
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

### Decision points

**C.1** Embedding sync timing. Synchronous on write (latency hit) vs async worker (eventual). **Recommend:** async — `promoted_to` returns immediately, retrieval falls back to lexical search until `embedded_at` is set.

**C.2** `page_content` as JSONB blob vs relational. JSONB matches the way admin edits whole blocks; relational lets us partial-index hero text. **Recommend:** JSONB; one row per owner; if a single field becomes search-critical later, denormalize a column.

**C.3** Media storage. Local filesystem (volume mounted) vs S3-compatible (MinIO/AWS). **Recommend:** local default with pluggable backend driver — `storage_key` works for both; install.sh sets `STORAGE_DRIVER=local`.

**C.4** Tag taxonomy. Free text `text[]` vs a `tags` table with FK relations. Free text is what the design uses (chip cycles inclusion/exclusion/silent per tag string). **Recommend:** free text; if owner tags get messy, add `tag_aliases` later.

**C.5** Owner-id enforcement layer. ORM Manager (`for_owner(req.owner)`) vs row-level security in Postgres. RLS is bulletproof but couples app to PG features and complicates testing. **Recommend:** ORM Manager + a middleware that sets `request.owner`; tests assert leakage with a "two owners, fetch should be empty" pattern. Revisit RLS if multi-tenant becomes real.

---

## D. API design

Three separate API surfaces. Each has its own auth, schema, and audience. They live in the same backend process but are routed and authorized independently.

### D.1 Admin REST API — `/api/admin/*`

- **Audience:** owner's browser (admin Next.js surface).
- **Auth:** session cookie (Django sessions in Redis) + CSRF for state-changing requests.
- **CORS:** same-origin only (admin is on instance domain).

Shape (illustrative, not exhaustive):

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
POST   /api/admin/codes/:id/members         -- pre-seed expected reviewers
DELETE /api/admin/codes/:id/members/:mid

GET    /api/admin/conversations             ?code_id=&tier=
GET    /api/admin/conversations/:id         -- full transcript

GET    /api/admin/page
PUT    /api/admin/page                      -- replace blocks atomically

POST   /api/admin/media                     -- multipart upload
GET    /api/admin/media                     ?attached_to=
DELETE /api/admin/media/:id

GET    /api/admin/tokens
POST   /api/admin/tokens                    -- response includes plaintext ONCE
DELETE /api/admin/tokens/:id

GET    /api/admin/connectors
POST   /api/admin/connectors/:kind/oauth/start    -> {redirect_url}
GET    /api/admin/connectors/:kind/oauth/callback  -- redirect target

POST   /api/admin/custom-pages
PATCH  /api/admin/custom-pages/:id          -- update source_files / packages
POST   /api/admin/custom-pages/:id/build    -- trigger sandbox build
GET    /api/admin/custom-pages/:id/build-log
```

### D.2 Public API — `/api/v1/*`

- **Audience:** SDK clients (instance's own Next.js public pages + any third-party site embedding the SDK).
- **Auth:** Bearer session token issued by `POST /api/v1/sessions`. Token is opaque (server-side Redis lookup), short TTL (1 hr), refreshable.
- **CORS:** open (`Access-Control-Allow-Origin: *`) on read endpoints; restricted to allow-listed origins on write endpoints (none today).

```
POST   /api/v1/sessions
  body: {
    handle: 'sijie',
    code?: 'LABEL-XXX',
    member_id?: uuid,           -- pick from access_code.code_members
    visitor_name?: string,      -- 'someone new' input
    byoai?: { provider: 'claude'|'openai' }   -- requests BYOAI session
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

GET    /api/v1/page/:handle                -- public page content (read-only)
GET    /api/v1/page/:handle/byoai-config   -- {enabled, providers, public_blurb}
GET    /api/v1/sdk/v1/manifest             -- SDK build metadata (for instance-served <script>)
```

### D.3 MCP server — `/mcp/`

- **Audience:** owner's AI client (Claude Desktop, Cursor, etc.).
- **Auth:** `Authorization: Bearer smk_…`.
- **Protocol:** FastMCP streamable HTTP.

Tool surface:

```
raw_dump(body, tags?, source_label?, attach_media_id?)
  -> {raw_id}

promote_to_wiki(raw_id, title, visibility, tags?)
  -> {wiki_id}

upload_media(base64, mime, attached_to?: {kind, id})
  -> {media_id, storage_key}

set_tags(entry_kind, entry_id, tags)         -- replace tags
add_tags / remove_tags                       -- incremental

list_recent(kind, limit=20, since?)
search_wiki(query, limit=10, visibility_filter?)
get_wiki(wiki_id)

archive(entry_kind, entry_id)
```

### D.4 Internal endpoints — `/internal/*`

- `/internal/healthz` — for Caddy probe + uptime.
- `/internal/tls-ask?domain=…` — Caddy on-demand TLS gatekeeper. Returns 200 iff the domain matches an owner's `custom_domain_status='verified'`.
- `/internal/log` — frontend error report sink (optional).

### Decision points

**D.1** SSE vs WebSocket for the chat stream. SSE is HTTP, plays nice with CORS / proxies / browsers; we lose only bi-directional which we don't need. **Recommend:** SSE.

**D.2** BYOAI key path. Visitor's API key should never reach our server. Flow: server returns RAG context + filtered scope; SDK runs the inference call directly against `api.anthropic.com` / `api.openai.com` using visitor's key. Server proxy alternative is simpler but stores liability. **Recommend:** client-side direct, two-step (RAG → infer).

**D.3** MCP auth — API token now, OAuth flow later. Owner builds a token in admin, pastes the JSON snippet into Claude Desktop. Adds friction but is bulletproof and v0. **Recommend:** API tokens for v1, add OAuth provider in v2 once MCP OAuth conventions settle.

**D.4** Session token storage. Server-side opaque (Redis lookup, revocable) vs JWT (stateless, revocation requires deny-list). Owners revoking codes need instant effect. **Recommend:** opaque + Redis.

**D.5** Idempotency on `raw_dump`. AI may retry on transient failures and double-write. **Recommend:** require `request_id` (uuid) header on MCP writes, server dedupes within a window.

---

## E. Auth

Five auth scenarios, each with its own surface:

| Scenario | Surface | Mechanism |
|---|---|---|
| First-run instance claim | `/setup?t=<token>` | one-shot `setup_token` printed to console |
| Owner login | `/login` | email + password → session cookie |
| MCP client | `/mcp/*` | `Authorization: Bearer smk_…` (API token) |
| Visitor code access | `/api/v1/sessions` | code → session token |
| Visitor BYOAI access | `/api/v1/sessions` | `byoai: true` → session token (public-scope) |

### First-run claim flow

1. Container starts. `instance_settings.is_claimed=false`. Backend generates a one-shot `setup_token`, stores it in `instance_settings.setup_token`, and prints to stdout:
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │ STANDMEET is ready. Claim this instance:                    │
   │   https://your-domain.example/setup?t=eyJh…                 │
   └─────────────────────────────────────────────────────────────┘
   ```
2. Owner opens link → `app/(auth)/setup` page → fills email/password/handle/full_name → `POST /api/admin/claim {token, …}`.
3. Backend verifies token, creates owner, marks `is_claimed=true`, clears `setup_token`. Endpoint refuses subsequent calls.
4. Owner is auto-logged-in.

### Owner-id propagation

- Middleware `set_request_owner` runs early. Reads session cookie → resolves owner. For `/mcp/*` reads bearer token. For `/api/v1/*` reads session token.
- All ORM access goes through model managers that take `request.owner`. A model without an explicit owner filter raises in development (a guard middleware in DEBUG mode).
- Single-owner v1: same `owner_id` for every row, so it's harmless if a manager is accidentally called without filter — but the guard catches it anyway.

### Sessions in detail

- Cookie name `smt_session`, HttpOnly, Secure, SameSite=Lax, Path=/api/admin.
- Redis-backed, key `session:{token}` → `{owner_id, expires_at, csrf_token}`.
- CSRF: double-submit cookie pattern for admin endpoints.

### Visitor session token

- Opaque random 32 bytes, base64url, prefixed `smv_`.
- Redis key `vsession:{token}` → `{owner_id, code_id?, member_id?, scope, byoai?, expires_at}`.
- TTL 60 min, slides on each request up to 8 h max.

### API tokens

- Plaintext format `smk_<24-char-base32>`. Backend stores `sha256(plaintext)` only.
- Created via admin; the only place plaintext is ever shown.
- Revocation: setting `revoked_at` immediately rejects.

### Decision points

**E.1** Setup token delivery. Console print only, or also write to a host file (`./first-run-token.txt`) for users not watching stdout. **Recommend:** both — print and write, file deleted after claim.

**E.2** Password hashing. Argon2id via passlib. **Recommend:** Argon2id (Django supports natively in modern versions).

**E.3** CSRF model. Cookie + matching header (`X-CSRFToken`) submitted by admin frontend on every mutating call. **Recommend:** standard Django CSRF, served via `/api/admin/csrf` endpoint that the frontend hits on bootstrap.

**E.4** API token scopes. Granular (`mcp:raw_dump`, `mcp:promote`, `mcp:read`) vs coarse (`mcp:write`, `mcp:read`). **Recommend:** coarse v1 with field reserved for granular later — owner doesn't want to manage 8 scopes for their own AI.

**E.5** Cross-origin admin (if owner wants admin on `admin.example.com` separate from public `example.com`). Adds CORS pain. **Recommend:** disallow in v1; admin lives at `/admin` on the same host as public.

---

## F. Multi-tenant readiness

The shape: v1 wires single-owner everywhere but the *data* and *URL surface* are tenancy-shaped already.

### Data layer

- Every domain table has `owner_id`.
- Model managers take `for_owner(owner)`; no manager exposes an "all owners" view.
- Storage paths prefixed `{owner_id}/…`.
- Page-builder output paths prefixed `custom/{owner_id}/…`.

### URL layer (v1 vs v2)

| Surface | v1 (single-owner) | v2 (multi-tenant) |
|---|---|---|
| Public chat | `/` or `/[handle]` | `/[handle]` |
| Gate | `/gate` or `/[handle]/gate` | `/[handle]/gate` |
| Admin | `/admin` (owner login required) | `/admin` (owner login required, scoped) |
| Login | `/login` | `/login` |
| Setup | `/setup?t=` | replaced by `/signup` |

Either:
- (a) v1 mounts public on `/` with the only owner's handle hardcoded by middleware; v2 unmounts that and uses `/[handle]`; OR
- (b) v1 already uses `/[handle]` but the rewrite middleware folds `/` → `/{owner_handle}` so it works for both modes.

**Recommend:** (b). Less code churn at multi-tenant flip.

### Flag

`instance_settings.multi_tenant: bool`. Controls:
- whether `/setup` is reachable after first claim
- whether `/signup` is reachable
- whether `POST /api/admin/claim` is reachable for additional owners

### Decision points

**F.1** Hostname strategy at v2: `/[handle]` paths vs `[handle].domain` subdomains. Subdomain is more "personal page" but adds wildcard SSL + DNS. **Recommend:** plan for both; v1 path-based; v2 toggleable with `multi_tenant_url_style ∈ {path, subdomain}`.

**F.2** Custom domain ownership. In multi-tenant, the same instance hosts many custom domains. Caddy on-demand TLS asks `/internal/tls-ask?domain=…` to check it maps to an owner. **Recommend:** already covered by the data model; document it.

**F.3** Storage isolation. Local filesystem with `{owner_id}/...` paths is fine for v1 but doesn't enforce isolation. **Recommend:** v1 accept the soft barrier; document hardening (per-owner UID, quota) as a v2 task.

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
      - STANDMEET_EMAIL              # for Let's Encrypt
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
      - DATABASE_URL=postgres://standmeet:${DB_PASSWORD}@db/standmeet
      - REDIS_URL=redis://redis:6379/0
      - DJANGO_SECRET_KEY
      - STORAGE_DRIVER=local
      - STORAGE_ROOT=/srv/media
    volumes:
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

The `builder` service is NOT in compose — spawned by the backend with `docker run --rm` (or via a small SDK like docker-py) per build.

### Caddyfile (sketch)

```
{
  email {$STANDMEET_EMAIL}
  on_demand_tls {
    ask http://backend:8000/internal/tls-ask
  }
}

{$STANDMEET_DOMAIN} {
  # API + MCP
  handle_path /api/* { reverse_proxy backend:8000 }
  handle_path /mcp/* { reverse_proxy backend:8000 }
  # Custom-page static output
  handle_path /custom/* { root * /srv/custom; file_server }
  # Everything else → Next.js
  reverse_proxy app:3000
}

# Owner custom domains, on-demand TLS
:443 {
  tls {
    on_demand
  }
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
# 4. Generate .env with random DJANGO_SECRET_KEY + DB_PASSWORD
# 5. docker compose pull && docker compose up -d
# 6. Tail backend logs until "STANDMEET is ready" banner, print setup URL
```

### Migrations

Backend `entrypoint.sh` runs `manage.py migrate --noinput` before starting uvicorn. Breaking migrations flagged in release notes; major version bumps documented in `MIGRATION.md`.

### Backup / restore

- `make backup` → `pg_dump` + `tar` of `media/` + `custom_pages/` → single dated tarball.
- `make restore TARBALL=…` → restores into fresh volumes.
- v1: no automatic schedule; document cron one-liner.

### Decision points

**G.1** On-demand TLS rate limiting. Required to avoid abuse if anyone CNAMEs a domain at our IP. The `/internal/tls-ask` endpoint enforces it. **Recommend:** ask endpoint checks `custom_domain_status='verified'` (owner must verify via TXT record before activation).

**G.2** Zero-downtime upgrades. **Recommend:** not in v1 — accept 5–10s downtime on `docker compose up`. v2 explores blue/green.

**G.3** Migration runner. Auto-migrate on startup (current Django convention) vs explicit `make migrate`. **Recommend:** auto-migrate with a `MIGRATE_ON_START=false` escape hatch.

**G.4** Builder isolation level. `docker run --rm` with no network + tmpfs + drop-capabilities is reasonable. Tighter is gVisor/Firecracker. **Recommend:** docker run with seccomp profile + `--network=none` + read-only root + tmpfs `/tmp`. Document upgrade path to gVisor.

---

## H. Observability and error handling

### Logging

- **Backend:** structured JSON to stdout (Django `logging.JSONFormatter` or `structlog`). Fields: `ts, level, owner_id?, request_id, route, msg`.
- **Frontend:** errors posted to `/internal/log` (rate-limited).
- **Caddy:** JSON access log.
- **Builder:** stdout captured into `custom_pages.build_log`; owner can read in admin.

### Health checks

- `GET /internal/healthz` → 200 if PG + Redis reachable.
- App container `GET /api/healthz` proxies to backend.
- Caddy waits on these before routing.

### User-facing errors (the rule from old CLAUDE.md, preserved)

Standard envelope:

```json
{ "error": { "code": "tier_insufficient", "message": "...", "hint": "..." } }
```

Frontend has a single `friendlyError(code)` helper that maps codes to displayable copy. Default fallback `"Something went wrong"` — never a stack trace, never an exit code.

A short curated code list to start:

| code | meaning | UI shows |
|---|---|---|
| `code_invalid` | access code unknown / revoked | "That code didn't work. Double-check it or request access." |
| `code_expired` | access code past expiry | "This code has expired. Request a new one." |
| `tier_insufficient` | private content in public/byoai tier | inline "public scope only · need a code" block |
| `byoai_disabled` | owner toggled off | "BYOAI isn't enabled on this page. Use an access code instead." |
| `ratelimited` | too many requests | "Slow down — try again in a minute." |
| `not_found` | bad handle / 404 | standard 404 page |
| `server_error` | catch-all | "Something went wrong." (+ request_id for support) |

### Metrics

- v1: structured logs, ad-hoc query.
- v2: Prometheus exporter behind `/internal/metrics`, requires basic-auth.

### Decision points

**H.1** Telemetry. Opt-in anonymous instance ping (Coolify does this). **Recommend:** no for v1; self-host crowd values privacy.

**H.2** Frontend error reporter. Self-hosted (`/internal/log`) vs Sentry. **Recommend:** self-hosted; v2 makes Sentry DSN configurable.

**H.3** Request ID propagation. UUID generated by Caddy → forwarded as `X-Request-ID` to backend → echoed on error envelopes for support correlation. **Recommend:** yes.

**H.4** Build log size cap. `custom_pages.build_log` text could grow. **Recommend:** truncate at 64 KB with `(truncated)` marker.

---

## Cross-cutting principles

1. **owner_id is non-negotiable.** Every domain table, every query, every storage path.
2. **Three API surfaces, three auth mechanisms, one process.** Don't merge admin and public API endpoints "for convenience."
3. **The SDK is a first-class consumer of the public API.** If something hard to expose to the SDK, the API is wrong.
4. **Self-host friendliness > feature richness.** Anything that needs an external SaaS account is a v2 concern.
5. **Errors are UI copy.** Backend codes are stable; frontend strings are localized; never leak.

---

## Open questions outside this doc's scope

These are surfaced here as known unknowns. Decide in a follow-up:

- **Inference cost for code-tier conversations** — owner pays via configured API key (Anthropic/OpenAI) stored as `connector` or env var? Spec'd in `connectors` table conceptually but UX in admin not designed yet.
- **Custom-page deploy pipeline** — when an owner pushes a new revision, does the public URL switch atomically, or stage and require explicit publish? The design's "preview" semantics aren't defined.
- **IM bridge (Telegram/Discord/Slack) integration** — out of scope for first slice, but the data model (raw_entries with `source='telegram-bot'`) and access code semantics (visitor authenticates with code via bot DM) are already accommodated.
- **Electron client** — same. Ingest channel already supported; UX out of scope here.
- **Connectors (Email / Calendar)** — schema present; tool-call rendering in chat (`tool_calls jsonb`) supports calendar slot proposals; full OAuth flow design deferred.

---

*End of code architecture draft. Reply with decision-point acceptances or changes (e.g. "A.1: accept; B.1: change — no shadcn, hand-build everything").*
