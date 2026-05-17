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
    created_at           timestamptz   NOT NULL DEFAULT now()
);

-- Instance settings —— singleton（id=1，CHECK 强制）。
-- 模式参考 [[legacy-gems]] B1（singleton pk=1 + LoadOrCreate）。
CREATE TABLE instance_settings (
    id                integer      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_claimed        boolean      NOT NULL DEFAULT false,
    setup_token_hash  text,
    multi_tenant      boolean      NOT NULL DEFAULT false,
    deployed_at       timestamptz  NOT NULL DEFAULT now()
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

-- Corpus —— raw 草稿 + wiki curated；M6 加 embedding + SEO landing 列。
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
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    parent_id       uuid          REFERENCES wiki_entries(id) ON DELETE SET NULL,
    title           text          NOT NULL,
    body            text          NOT NULL,
    tags            text[]        NOT NULL DEFAULT '{}',
    visibility      text          NOT NULL DEFAULT 'public',
    source_raw_ids  uuid[]        NOT NULL DEFAULT '{}',
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

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

-- Access codes + visitor chat (M6)
CREATE TABLE access_codes (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code                citext        UNIQUE NOT NULL,
    label               text          NOT NULL,
    purpose             text          NOT NULL DEFAULT '',
    included_tags       text[]        NOT NULL DEFAULT '{}',
    excluded_tags       text[]        NOT NULL DEFAULT '{}',
    suggested_questions jsonb         NOT NULL DEFAULT '[]'::jsonb,
    expires_at          timestamptz,
    status              text          NOT NULL DEFAULT 'active',
    created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE code_members (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id       uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    display_name  text          NOT NULL,
    email         citext,
    is_anonymous  boolean       NOT NULL DEFAULT false,
    last_seen_at  timestamptz
);

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
