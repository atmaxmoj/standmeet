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
    -- public_url —— owner 对外的完整 URL (scheme + host + port，如
    -- "https://alice.dev" 或 "http://localhost:38127")。claim 时必填、
    -- admin 可改。SEO canonical / QR 全读这一列。空串视为"未填" —— claim
    -- usecase 强制非空，但 ALTER 加列时为兼容老行设 DEFAULT ''。
    public_url           text          NOT NULL DEFAULT '',
    byoai_enabled        boolean       NOT NULL DEFAULT true,
    byoai_providers      jsonb         NOT NULL DEFAULT '["claude","openai"]'::jsonb,
    byoai_public_blurb   text          NOT NULL DEFAULT '',
    -- owner 自己的 AI provider（"owner's AI"，给真访客 chat 用，跟上面
    -- byoai_* "访客自带 key" 路径完全独立）。
    -- key 走 AES-256-GCM 加密落盘，明文 INSTANCE_SECRET 在 env。
    -- mock 不在选项里——它是 INFERENCE_PROVIDER=mock env 下的 testing
    -- fixture，跟 owner 行无关。
    ai_provider          text          NOT NULL DEFAULT 'anthropic'
                                        CHECK (ai_provider IN ('anthropic', 'openai')),
    ai_provider_key_enc  bytea         NOT NULL DEFAULT ''::bytea,
    -- password_reset_hash —— 紧急 reset 兜底：CLI 颁发的一次性 token 的
    -- bcrypt-style hash。配合 password_reset_at 做 30min TTL。空 bytea =
    -- 没活跃 reset token；reset 成功后由 ClearPasswordResetToken 清回去。
    password_reset_hash  bytea         NOT NULL DEFAULT ''::bytea,
    password_reset_at    timestamptz,
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

-- output_entries —— raw → wiki → output 三层中的最精炼层。结构同 wiki，
-- 语义差别：output 是 "可以在对话里完整原样引用" 的成品；通过 MCP
-- `promote_wiki_to_output` 从 wiki 提炼上来。
CREATE TABLE output_entries (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    parent_id        uuid          REFERENCES output_entries(id) ON DELETE SET NULL,
    title            text          NOT NULL,
    body             text          NOT NULL,
    tags             text[]        NOT NULL DEFAULT '{}',
    visibility       text          NOT NULL DEFAULT 'public',
    source_wiki_ids  uuid[]        NOT NULL DEFAULT '{}',
    seo_slug         citext,
    seo_description  text          NOT NULL DEFAULT '',
    seo_indexed      bool          NOT NULL DEFAULT false,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX output_entries_owner_slug_idx
    ON output_entries(owner_id, seo_slug)
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
    output_entry_id uuid          REFERENCES output_entries(id) ON DELETE SET NULL,
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

-- job_sources —— owner 注册的 job source（greenhouse / lever / ashby /
-- remoteok / wwr / hn_hiring 等）。MCP `jobs.register_source` 写一行，
-- `jobs.fetch_new` 按这条 row 找 fetcher adapter + 抓真 API。
CREATE TABLE job_sources (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    kind            text          NOT NULL
                                  CHECK (kind IN (
                                    'greenhouse','lever','ashby',
                                    'remoteok','wwr','hn_hiring',
                                    'smartrecruiters','workable')),
    -- config 形状跟 kind 走: greenhouse / lever / ashby / smartrecruiters /
    -- workable 需 {"company": "..."}; wwr 需 {"categories": ["..."]};
    -- remoteok / hn_hiring 不需要 (空 object)。
    config          jsonb         NOT NULL DEFAULT '{}'::jsonb,
    label           text          NOT NULL,
    last_fetched_at timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX job_sources_owner_idx ON job_sources(owner_id, created_at DESC);

-- job_fingerprints —— 跨日 dedup 用; (source_id, external_id) 见过的就
-- 不再返回。永不过期 (TTL 用 source 级别 GC); external_id 是各 source
-- 自带的稳定 ID (greenhouse.id / lever.id / hn.comment_id / wwr.guid 等)。
CREATE TABLE job_fingerprints (
    source_id     uuid          NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
    external_id   text          NOT NULL,
    first_seen_at timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, external_id)
);

-- resume_drafts —— Phase 2 中间态：Claude 给出 resume_content 后 owner
-- 还在 preview 看，没点头 commit。draft 1d TTL（跟 Redis job 池子同周期），
-- 过期归 expires_at < now() 的 background sweeper 清。
--
-- 关键设计：PDF 永远 ephemeral —— server 端不落任何文件，每次 MCP 调用
-- 用 gopdf 现场渲染 bytes 塞响应，Claude 拿 bytes 经本地 Playwright MCP
-- 投递（recruiter 拿到的也只是最终投出去那一份）。表里只存结构化数据。
CREATE TABLE resume_drafts (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    -- job_cache_id 是 Redis key 后半段（job:{owner_id}:{job_cache_id}）。
    -- L.13 决策：draft 创建时已经把 job snapshot 复制到 job_snapshot 列了，
    -- commit 时不必再回查 Redis；保留 job_cache_id 给 admin "未发草稿"
    -- 视图显示 "这个草稿是给哪条 job 的"。
    job_cache_id     text          NOT NULL,
    job_snapshot     jsonb         NOT NULL,
    resume_content   jsonb         NOT NULL,
    expires_at       timestamptz   NOT NULL DEFAULT now() + interval '1 day',
    created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX resume_drafts_owner_idx ON resume_drafts(owner_id);
CREATE INDEX resume_drafts_expires_idx ON resume_drafts(expires_at);

-- applications —— Phase 3 持久化求职申请。一条 application 必须有一个
-- 同步 issue 的 access_code（recruiter 扫 QR 接回 visitor chat）。
-- access_code_id 是 NOT NULL FK + ON DELETE RESTRICT（删 code 前必须先删 application）。
-- 删 application 不级联删 code —— recruiter 即使在 application 删除后仍可用 QR
-- 访问（直到 code 自然过期或 owner 手动 revoke）。
CREATE TABLE applications (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    access_code_id uuid          NOT NULL REFERENCES access_codes(id) ON DELETE RESTRICT,
    job_snapshot   jsonb         NOT NULL,
    resume_content jsonb         NOT NULL,
    status         text          NOT NULL DEFAULT 'pending',
    submitted_at   timestamptz,
    created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX applications_owner_idx ON applications(owner_id);
CREATE INDEX applications_access_code_idx ON applications(access_code_id);
