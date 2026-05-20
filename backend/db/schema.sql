-- StandMeet canonical schema. 这份文件是 sqlc 的输入（生成 typed Go
-- query 函数时读这个看类型），同时也是给人看 "表结构现在是啥样" 的权威。
--
-- Schema 变化通过 db/migrations/*.sql（goose）演进；改了 schema.sql
-- 必须同步加 migration，否则 sqlc 生成的 Go 代码和 DB 实际状态会脱节。
--
-- 设计稿 C 章节是字段说明的权威；这里写 DDL 简洁不重复 doc。

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- Owners —— v1 单 owner（instance_settings.multi_tenant=false 锁定）；
-- 但 schema 已经按 multi-tenant 形状建（每张领域表都会带 owner_id FK）。
CREATE TABLE owners (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    email                citext        UNIQUE NOT NULL,
    password_hash        text          NOT NULL,
    handle               citext        UNIQUE NOT NULL,
    full_name            text          NOT NULL,
    location             text          NOT NULL DEFAULT '',
    custom_domain        citext        UNIQUE,
    custom_domain_status text          NOT NULL DEFAULT 'unset',
    byoai_enabled        boolean       NOT NULL DEFAULT true,
    byoai_providers      jsonb         NOT NULL DEFAULT '["claude","openai"]'::jsonb,
    byoai_public_blurb   text          NOT NULL DEFAULT '',
    -- owner 自己的 AI provider（"owner's AI"，给真访客 chat 用，跟上面
    -- byoai_* "访客自带 key" 路径完全独立）。
    -- key 走 AES-256-GCM 加密落盘，明文 INSTANCE_SECRET 在 env。
    ai_provider          text          NOT NULL DEFAULT 'mock'
                                        CHECK (ai_provider IN ('mock', 'anthropic', 'openai')),
    ai_provider_key_enc  bytea         NOT NULL DEFAULT ''::bytea,
    created_at           timestamptz   NOT NULL DEFAULT now()
);

-- Instance settings —— singleton（id=1，CHECK 强制）。
-- 模式：singleton pk=1 + LoadOrCreate。
CREATE TABLE instance_settings (
    id                integer      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_claimed        boolean      NOT NULL DEFAULT false,
    setup_token_hash  text,
    multi_tenant      boolean      NOT NULL DEFAULT false,
    deployed_at       timestamptz  NOT NULL DEFAULT now(),
    allowed_domains   jsonb        NOT NULL DEFAULT '[]'::jsonb
);

-- API tokens —— 对齐 youteacher 简化：无 scope 细粒度（占位 ARRAY['*']）、
-- 无 prefix 字段（name 就是 owner 看的标识）、撤销 = DELETE。
CREATE TABLE api_tokens (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name          text          NOT NULL,
    token_hash    text          UNIQUE NOT NULL,
    scopes        text[]        NOT NULL DEFAULT ARRAY['*'],
    last_used_at  timestamptz,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

-- Corpus —— raw 草稿 + wiki curated；embedding + SEO landing 列后续加。
CREATE TABLE raw_entries (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    body            text          NOT NULL,
    source          text          NOT NULL DEFAULT 'mcp',
    source_meta     jsonb         NOT NULL DEFAULT '{}'::jsonb,
    tags            text[]        NOT NULL DEFAULT '{}',
    flagged_private boolean       NOT NULL DEFAULT false,
    promoted_to     uuid,
    archived        boolean       NOT NULL DEFAULT false,
    created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE wiki_entries (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    parent_id        uuid          REFERENCES wiki_entries(id) ON DELETE SET NULL,
    title            text          NOT NULL,
    body             text          NOT NULL,
    tags             text[]        NOT NULL DEFAULT '{}',
    visibility       text          NOT NULL DEFAULT 'public',
    source_raw_ids   uuid[]        NOT NULL DEFAULT '{}',
    seo_slug         citext,
    seo_description  text          NOT NULL DEFAULT '',
    seo_indexed      bool          NOT NULL DEFAULT false,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wiki_entries_owner_slug_idx
    ON wiki_entries(owner_id, seo_slug)
    WHERE seo_slug IS NOT NULL;

CREATE TABLE media_assets (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    kind            text          NOT NULL,
    filename        text          NOT NULL,
    mime_type       text          NOT NULL,
    size_bytes      bigint        NOT NULL DEFAULT 0,
    storage_key     text          NOT NULL,
    raw_entry_id    uuid          REFERENCES raw_entries(id) ON DELETE SET NULL,
    wiki_entry_id   uuid          REFERENCES wiki_entries(id) ON DELETE SET NULL,
    created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Access codes + visitor chat
CREATE TABLE access_codes (
    id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                  uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code                      citext        UNIQUE NOT NULL,
    label                     text          NOT NULL,
    purpose                   text          NOT NULL DEFAULT '',
    included_tags             text[]        NOT NULL DEFAULT '{}',
    excluded_tags             text[]        NOT NULL DEFAULT '{}',
    suggested_questions       jsonb         NOT NULL DEFAULT '[]'::jsonb,
    expires_at                timestamptz,
    status                    text          NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active', 'revoked')),
    max_sessions_per_member   integer,
    max_turns_per_session     integer,
    created_at                timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE code_members (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id       uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    display_name  text          NOT NULL,
    email         citext,
    is_anonymous  boolean       NOT NULL DEFAULT false,
    revoked       boolean       NOT NULL DEFAULT false,
    last_seen_at  timestamptz
);
CREATE UNIQUE INDEX code_members_code_name_uniq ON code_members(code_id, display_name);

-- handle_aliases —— owner 改 handle 后旧 handle 入这里，旧 URL 仍能 resolve
-- 到同一个 owner。GetByHandle 走 owners.handle 优先，未命中走 alias。
CREATE TABLE handle_aliases (
    handle      citext        PRIMARY KEY,
    owner_id    uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    created_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX handle_aliases_owner_idx ON handle_aliases(owner_id);

CREATE TABLE conversations (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    tier            text          NOT NULL,
    code_id         uuid          REFERENCES access_codes(id) ON DELETE SET NULL,
    member_id       uuid          REFERENCES code_members(id) ON DELETE SET NULL,
    visitor_name    text          NOT NULL DEFAULT '',
    byoai_provider  text,
    started_at      timestamptz   NOT NULL DEFAULT now(),
    last_at         timestamptz   NOT NULL DEFAULT now(),
    message_count   integer       NOT NULL DEFAULT 0,
    hit_private     boolean       NOT NULL DEFAULT false
);

CREATE TABLE messages (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             text          NOT NULL,
    body             text          NOT NULL,
    tool_calls       jsonb,
    cited_wiki_ids   uuid[]        NOT NULL DEFAULT '{}',
    created_at       timestamptz   NOT NULL DEFAULT now()
);

-- custom_pages —— owner 自定义 React 页面。
CREATE TABLE custom_pages (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id               uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    slug                   citext        NOT NULL,
    title                  text          NOT NULL DEFAULT '',
    status                 text          NOT NULL DEFAULT 'active',
    live_build_id          uuid,
    staging_build_id       uuid,
    previous_live_build_id uuid,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_pages_owner_slug_idx ON custom_pages(owner_id, slug);

CREATE TABLE custom_page_builds (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         uuid          NOT NULL REFERENCES custom_pages(id) ON DELETE CASCADE,
    status          text          NOT NULL DEFAULT 'pending',
    source_files    jsonb         NOT NULL DEFAULT '{}'::jsonb,
    output_path     text          NOT NULL DEFAULT '',
    error_message   text          NOT NULL DEFAULT '',
    created_at      timestamptz   NOT NULL DEFAULT now(),
    built_at        timestamptz
);

-- access_requests —— visitor 在 /<handle>/gate 留言（无 code 时）。
-- owner 在 /admin/requests 看；open → replied (回邮件后) / closed (无视)。
CREATE TABLE access_requests (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name        text          NOT NULL DEFAULT '',
    org         text          NOT NULL DEFAULT '',
    email       citext        NOT NULL,
    message     text          NOT NULL DEFAULT '',
    status      text          NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'replied', 'closed')),
    created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX access_requests_owner_status_idx
    ON access_requests(owner_id, status, created_at DESC);

-- seo_settings —— owner 维度的 SEO 全局开关。Singleton-per-owner。
CREATE TABLE seo_settings (
    owner_id        uuid          PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    index_robots    bool          NOT NULL DEFAULT true,
    sitemap_extras  jsonb         NOT NULL DEFAULT '[]'::jsonb,
    og_template     text          NOT NULL DEFAULT '',
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- page_content —— owner public page 内容（hero / insights / projects /
-- where / contact）。Singleton-per-owner（PK = owner_id）。各 section 用
-- jsonb 存 schemaless 结构。设计稿 J / page-content.js 是字段语义来源。
CREATE TABLE page_content (
    owner_id        uuid          PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    hero_prose      text          NOT NULL DEFAULT '',
    hero_examples   jsonb         NOT NULL DEFAULT '[]'::jsonb,
    insights        jsonb         NOT NULL DEFAULT '[]'::jsonb,
    projects        jsonb         NOT NULL DEFAULT '[]'::jsonb,
    where_section   jsonb         NOT NULL DEFAULT '{}'::jsonb,
    contact         jsonb         NOT NULL DEFAULT '{}'::jsonb,
    updated_at      timestamptz   NOT NULL DEFAULT now()
);
