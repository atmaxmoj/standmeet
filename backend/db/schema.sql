-- StandMeet canonical schema —— 唯一权威。
--
-- v1 全新软件、未发布、没有任何 production 数据需要 migrate。所以本仓库
-- 不维护增量 migrations 文件。schema 变化的方式：
--   1. 改本文件
--   2. `make clean && make dev` 重建 db volume —— postgres docker image
--      自动从 /docker-entrypoint-initdb.d/01-schema.sql apply 这份文件
--   3. sqlc 在 codegen 时读本文件生成 Go 代码（sqlc.yaml schema 字段指它）
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
-- fresh volume 初始化时种一行；setup token 跟 claim 状态由 boot 写。
CREATE TABLE instance_settings (
    id                integer      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_claimed        boolean      NOT NULL DEFAULT false,
    setup_token_hash  text,
    multi_tenant      boolean      NOT NULL DEFAULT false,
    deployed_at       timestamptz  NOT NULL DEFAULT now(),
    allowed_domains   jsonb        NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

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

-- wiki_entries —— curated 中层。
-- path：唯一标识 (取代 seo_slug)。retrieval ACL 按 path-glob 评估；同时
--       是 /<handle>/wiki/<path> 公开页 URL 的最后一段（catch-all）。
-- show_as_source：false 时 AI 可以 read_corpus_entry 拿 body，但 readCollector
--       不收录这条 path —— 用于 meta/persona 这种"用得到但不该曝光"的 entry。
-- 准入靠 access_codes.corpus_permissions（path-glob first-match-wins）。
-- 没有 visibility 字段——legacy 那套 public/on_request/private 三档被 ACL 替代。
CREATE TABLE wiki_entries (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    parent_id        uuid          REFERENCES wiki_entries(id) ON DELETE SET NULL,
    title            text          NOT NULL,
    body             text          NOT NULL,
    tags             text[]        NOT NULL DEFAULT '{}',
    source_raw_ids   uuid[]        NOT NULL DEFAULT '{}',
    path             citext,
    show_as_source   bool          NOT NULL DEFAULT true,
    seo_description  text          NOT NULL DEFAULT '',
    seo_indexed      bool          NOT NULL DEFAULT false,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wiki_entries_owner_path_idx
    ON wiki_entries(owner_id, path)
    WHERE path IS NOT NULL;

-- output_entries —— raw → wiki → output 三层中的最精炼层。结构同 wiki，
-- 语义差别：output 是 "可以在对话里完整原样引用" 的成品；通过 MCP
-- `promote_wiki_to_output` 从 wiki 提炼上来。path / show_as_source 含义
-- 与 wiki_entries 完全一致；retrieval ACL 同套规则评估。
CREATE TABLE output_entries (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    parent_id        uuid          REFERENCES output_entries(id) ON DELETE SET NULL,
    title            text          NOT NULL,
    body             text          NOT NULL,
    tags             text[]        NOT NULL DEFAULT '{}',
    source_wiki_ids  uuid[]        NOT NULL DEFAULT '{}',
    path             citext,
    show_as_source   bool          NOT NULL DEFAULT true,
    seo_description  text          NOT NULL DEFAULT '',
    seo_indexed      bool          NOT NULL DEFAULT false,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX output_entries_owner_path_idx
    ON output_entries(owner_id, path)
    WHERE path IS NOT NULL;

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

-- Access codes —— owner 发给访客的访问码 (LABEL-XXX 格式)；一码多人共用。
-- corpus_permissions：path-glob ACL，first-match-wins by order ascending，
--                     default deny。空列表 → 全允许 (无 ACL = 允许全部)。
--                     形状：[{"action": "allow"|"deny", "path_pattern": "...", "order": n}]。
CREATE TABLE access_codes (
    id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                  uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code                      citext        UNIQUE NOT NULL,
    label                     text          NOT NULL,
    purpose                   text          NOT NULL DEFAULT '',
    corpus_permissions        jsonb         NOT NULL DEFAULT '[]'::jsonb,
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

-- skills —— owner-curated AI persona/能力包。每条 skill 是一段附加 system
-- prompt（"You are an expert code reviewer..."），可选附带 scripts (sandbox
-- 执行的 owner-uploaded code，未来 B4 接) + metadata + version + license。
-- owner 在 admin 里 create/edit/install；每个 InviteCode 选一组 skills，
-- visitor session 拼 base persona + 选中 skill 的 prompt。
--
-- is_builtin：seed 出来的 5 个内置 skill (Code Review / Frontend Design /
--   Resume Portfolio / Technical Interview / Conversation Report) 标 true；
--   owner 自己加的 = false。删除时 builtin 不允许删，re-seed 也以 name 为键。
CREATE TABLE skills (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name            text          NOT NULL,
    description     text          NOT NULL DEFAULT '',
    prompt          text          NOT NULL DEFAULT '',
    scripts         jsonb         NOT NULL DEFAULT '[]'::jsonb,
    metadata        jsonb         NOT NULL DEFAULT '{}'::jsonb,
    allowed_tools   text[]        NOT NULL DEFAULT '{}',
    is_builtin      bool          NOT NULL DEFAULT false,
    version         text          NOT NULL DEFAULT '',
    license         text          NOT NULL DEFAULT '',
    source          text          NOT NULL DEFAULT 'manual',
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX skills_owner_name_uniq ON skills(owner_id, name);

-- code_skills —— InviteCode ↔ Skill 多对多。同 code 选多 skill；同 skill
-- 多 code 共享。FK ON DELETE CASCADE：删 code 自动清；删 skill 自动清。
CREATE TABLE code_skills (
    code_id   uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    skill_id  uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (code_id, skill_id)
);

CREATE INDEX code_skills_skill_idx ON code_skills(skill_id);

-- mcp_servers —— owner-registered external MCP servers (URL + optional
-- auth header)。InviteCode 绑一组 mcp_server_ids；visitor chat 把这些 server
-- 的 tool 也加进可用列表 (ext_<server>_<tool>)。auth_header_value 落
-- cryptobox AES-256-GCM 密文，跟 BYOAI key 同套模式（INSTANCE_SECRET KEK）。
CREATE TABLE mcp_servers (
    id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name                    text          NOT NULL,
    url                     text          NOT NULL,
    auth_header_name        text          NOT NULL DEFAULT '',
    auth_header_value_enc   bytea         NOT NULL DEFAULT '\x'::bytea,
    created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mcp_servers_owner_name_uniq ON mcp_servers(owner_id, name);

-- code_mcp_servers —— InviteCode ↔ McpServer 多对多。
CREATE TABLE code_mcp_servers (
    code_id        uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    mcp_server_id  uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    PRIMARY KEY (code_id, mcp_server_id)
);

CREATE INDEX code_mcp_servers_server_idx ON code_mcp_servers(mcp_server_id);

-- assets —— owner-uploaded 二进制 (图片 / 附件) 的元数据。bytes 落 MinIO
-- 对象存储 (key = '<owner_id>/<asset_id>')；元数据在这里。posts / raw /
-- wiki / custom_pages 通过 asset_id 引用，URL 走 backend presign。
-- sha256 让重复上传可在 caller 端 dedup (本表不强制 unique)。
CREATE TABLE assets (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id           uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    storage_key        text          NOT NULL,
    content_type       text          NOT NULL DEFAULT 'application/octet-stream',
    size_bytes         bigint        NOT NULL DEFAULT 0,
    sha256             text          NOT NULL DEFAULT '',
    original_filename  text          NOT NULL DEFAULT '',
    created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX assets_owner_created_idx ON assets(owner_id, created_at DESC);
CREATE INDEX assets_sha256_idx ON assets(owner_id, sha256) WHERE sha256 <> '';

-- posts —— blog 文章。设计源自 claude.ai/design 的 posts.js + blog.html
-- (Stripe-Press 风 essays)。文章本身是 corpus entry 的展开版：visitor chat
-- retriever 可读 (path='posts/<slug>')；private 文章通过 path-glob ACL 走
-- 跟 wiki 同一套 corpus_permissions (InviteCode 的 path_pattern 匹 path)。
--
-- body_md —— canonical 唯一存储格式，GitHub-flavored markdown。owner 在
-- admin Tiptap 编辑器里写（编辑器底层 round-trip markdown），MCP `post_create`
-- 也只接 markdown，AI 原生吐什么我们就存什么。不发明 "block JSON" 中间态、
-- 不存 "格式标签"——单一形态，render 端 react-markdown + remark-gfm 直渲。
--
-- cover 是 typographic (大字 + sub + hue)，不上图也好看；可选 cover_image
-- _asset_id 后续支持真图 (落 assets 表)。
--
-- visibility: 'public' 或 'private'；private 在 path-glob ACL 走 deny
-- 默认，特定 code 的 allow rule 放行。
--
-- read_minutes：denormalized 字段，Create/Update 时从 body_md 重算。原因是
-- list endpoint 不希望为每行算一遍 word count（也不想 ship body_md 给 list）。
--
-- published_at NULL = 草稿；NOT NULL = 已发布，前端公开 list 才显示。
CREATE TABLE posts (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    slug                  text          NOT NULL,
    title                 text          NOT NULL,
    excerpt               text          NOT NULL DEFAULT '',
    body_md               text          NOT NULL DEFAULT '',
    cover_headline        text          NOT NULL DEFAULT '',
    cover_sub             text          NOT NULL DEFAULT '',
    cover_hue             text          NOT NULL DEFAULT 'amber',
    cover_image_asset_id  uuid          NULL REFERENCES assets(id) ON DELETE SET NULL,
    tags                  text[]        NOT NULL DEFAULT '{}',
    visibility            text          NOT NULL DEFAULT 'public',
    cross_refs            text[]        NOT NULL DEFAULT '{}',
    path                  text          NOT NULL,
    read_minutes          int           NOT NULL DEFAULT 0,
    locked_body           text          NOT NULL DEFAULT '',
    published_at          timestamptz   NULL,
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX posts_owner_slug_uniq ON posts(owner_id, slug);
CREATE INDEX posts_owner_published_idx ON posts(owner_id, published_at DESC NULLS LAST);
CREATE INDEX posts_owner_path_idx ON posts(owner_id, path);

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
    -- ended_at + summary_md：A2 /summary 路径写。session ended 之后
    -- visitor 不能再发消息（POST /messages 返 410 conversation_ended）。
    -- summary_md 是 AI 生成的 markdown 报告，visitor 客户端拿去渲染 PDF。
    ended_at        timestamptz,
    summary_md      text          NOT NULL DEFAULT ''
);

CREATE TABLE messages (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             text          NOT NULL,
    body             text          NOT NULL,
    tool_calls       jsonb,
    cited_wiki_ids   uuid[]        NOT NULL DEFAULT '{}',
    cited_output_ids uuid[]        NOT NULL DEFAULT '{}',
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
