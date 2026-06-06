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
    --
    -- 列 ai_provider 现在接受 inference.presets 里全部 openai-compat
    -- provider + 'anthropic'，所以没 CHECK 白名单（presets 表是 source
    -- of truth；DB CHECK 跟代码漂移更糟）。
    -- ai_endpoint —— 仅 provider='custom' 必填（owner 自托管 ollama / vllm /
    -- lm-studio 等 OpenAI-compatible server 的 base URL，不带 /v1/...）；
    -- 其它 provider 留空走 preset 默认 BaseURL。
    -- ai_model —— 留空走 preset 默认 model；owner 想换模型时填。
    ai_provider          text          NOT NULL DEFAULT 'anthropic',
    ai_provider_key_enc  bytea         NOT NULL DEFAULT ''::bytea,
    ai_endpoint          text          NOT NULL DEFAULT '',
    ai_model             text          NOT NULL DEFAULT '',
    -- password_reset_hash —— 紧急 reset 兜底：CLI 颁发的一次性 token 的
    -- bcrypt-style hash。配合 password_reset_at 做 30min TTL。空 bytea =
    -- 没活跃 reset token；reset 成功后由 ClearPasswordResetToken 清回去。
    password_reset_hash  bytea         NOT NULL DEFAULT ''::bytea,
    password_reset_at    timestamptz,
    -- profile_timezone —— IANA tz name ('America/New_York' / 'Asia/Shanghai').
    -- 用于 owner_booking_policy 解释 working_hours / allowed_weekdays。空串
    -- 视为 'UTC'。owner 在 admin profile 改；claim 时空串。
    profile_timezone     text          NOT NULL DEFAULT '',
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

-- Owner keypairs —— Phase C: Ed25519 keypair 替换 API tokens。
-- key_id 是公开 stub (owner 在 admin UI 看 + 写 ~/.standmeet/credentials.json)；
-- public_key_pem 是 PKCS8 PEM 格式的 Ed25519 公钥。私钥永远不入库 (owner
-- 自己保管 PEM)。撤销 = DELETE (硬删，对齐 youteacher 简化)。
CREATE TABLE owner_keypairs (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    key_id          text          UNIQUE NOT NULL,
    public_key_pem  text          NOT NULL,
    label           text          NOT NULL,
    last_used_at    timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now()
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
-- show_as_source：false 时 AI 可以 corpus_read 拿 body，但 readCollector
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
-- access_codes —— 访客访问码。A.3-IAM 起所有 ACL / capability gating 都从
-- assumed_role_id 指向的 Role 推断（[[role_snapshot]] 在 session issue 时
-- freeze）；不再有 corpus_permissions / granted_skills / code_skills /
-- code_mcp_servers 这些散落字段。max_bookings 仍直接挂 code（per-code
-- 跨 visitor 累计计数）。
CREATE TABLE access_codes (
    id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                  uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code                      citext        UNIQUE NOT NULL,
    label                     text          NOT NULL,
    purpose                   text          NOT NULL DEFAULT '',
    suggested_questions       jsonb         NOT NULL DEFAULT '[]'::jsonb,
    expires_at                timestamptz,
    status                    text          NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active', 'revoked')),
    max_sessions_per_member   integer,
    max_turns_per_session     integer,
    -- max_bookings —— calendar.book quota per code。NULL = role 没解锁
    -- calendar.book skill 时也无意义；解锁了的话正整数 = 总配额，跨 visitor /
    -- session 累计 (从 code_bookings count)。耗尽后 tool 报 quota_exhausted。
    max_bookings              integer,
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

-- code_skills / code_mcp_servers 在 A.3-IAM-5 删除。访客 capability gating
-- 从 access_codes.assumed_role_id 指向的 Role 推断；role_skills /
-- role_mcp_servers 才是真 source of truth。

-- mcp_servers —— owner-registered external MCP servers (URL + optional
-- auth header)。Role 通过 role_mcp_servers 引一组 server id；visitor chat
-- 把这些 server 的 tool 也加进可用列表 (ext_<server>_<tool>)。
-- auth_header_value 落 cryptobox AES-256-GCM 密文，跟 BYOAI key 同套模式
-- （INSTANCE_SECRET KEK）。
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

-- prompts —— owner-scoped persona/instruction 片段库。
-- 设计 [[iam-role-pivot-plan]]：type 通用命名，挂 role 后语义角色叫"role
-- prompt"，但 type 本身不带这个限定（未来 skill / page 也可能复用同张表）。
-- builtin（is_builtin=true）现在只有一行 "vanilla" —— claim 时种，删除被
-- repo 层拒；owner 自己加的 = false。
CREATE TABLE prompts (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name         text          NOT NULL,
    body         text          NOT NULL DEFAULT '',
    description  text          NOT NULL DEFAULT '',
    is_builtin   boolean       NOT NULL DEFAULT false,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prompts_owner_name_uniq ON prompts(owner_id, name);

-- roles —— owner-scoped visitor 身份原型。one-stop config：persona (Prompt) +
-- 可见 corpus (URI globs via role_corpus_uris) + 解锁的 capability (Skills via
-- role_skills + MCP servers via role_mcp_servers)。每张 access_code 挂一个
-- assumed_role_id；session start 时拍 RoleSnapshot 进 session_data，跟 role
-- 解耦（owner 改 role 不影响 in-flight session）。
--
-- vanilla role：claim 时种，is_builtin=true，公开 corpus URIs / 无 skill /
--   无 mcp / prompt 挂 vanilla prompt；不可删（repo 层拒）。owner 不显式
--   选 role 时 access_code 默认挂这条。
CREATE TABLE roles (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name         text          NOT NULL,
    description  text          NOT NULL DEFAULT '',
    prompt_id    uuid          REFERENCES prompts(id) ON DELETE SET NULL,
    is_builtin   boolean       NOT NULL DEFAULT false,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roles_owner_name_uniq ON roles(owner_id, name);

-- role_corpus_uris —— Role 持的"可见 corpus URI 白名单"。glob 用现
-- compileGlob 方言（** 跨 /，* 不跨）。raw://** 永远 deny，跟此表配置无关
-- （hardcode in Role.AllowsCorpus）；空表 = 该 role 看不到任何 corpus。
CREATE TABLE role_corpus_uris (
    role_id      uuid          NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    uri_pattern  text          NOT NULL,
    PRIMARY KEY (role_id, uri_pattern)
);

-- role_skills —— Role ↔ Skill 多对多。code 不再直接挂 skill；走 role 转一层。
CREATE TABLE role_skills (
    role_id   uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    skill_id  uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, skill_id)
);

CREATE INDEX role_skills_skill_idx ON role_skills(skill_id);

-- role_mcp_servers —— Role ↔ MCP server 多对多。同上，code 不再直接挂。
CREATE TABLE role_mcp_servers (
    role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    mcp_server_id  uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, mcp_server_id)
);

CREATE INDEX role_mcp_servers_server_idx ON role_mcp_servers(mcp_server_id);

-- access_codes.assumed_role_id —— A.3-IAM-5 NOT NULL：每张码必挂 role。
-- 不显式选 = 上层 usecase 默认绑 owner 的 vanilla role。
ALTER TABLE access_codes
    ADD COLUMN assumed_role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT;

-- assets —— owner-uploaded 二进制 (图片 / 附件) 的元数据。bytes 落 MinIO
-- (key = '<owner_id>/<asset_id>')；元数据在这里。
--
-- 引用完整性：asset 行只有在归属一个 holder 实体 (post / 未来 wiki /
-- output / ...) 时才存在。upload 不能脱离 holder 单独发生——只走 multipart
-- save (POST /api/admin/writings/ 接 writing fields + 内联 image file)。upload
-- + insert assets 行 + insert/update post 在一个事务里。
--
-- holder_id 是对应实体的 UUID（post.id / wiki.id / ...）。PG 不支持
-- polymorphic FK 所以这列不挂 DB-level 外键；引用完整性靠 app 层在 holder
-- CRUD 事务里维护：
--   - create holder + 它的图：同事务 INSERT post + INSERT assets
--   - delete holder：同事务 DELETE assets WHERE holder_id = post.id；
--     commit 后批删 MinIO blob (best-effort，失败 log；dead blob 对业务
--     不可见，不影响 invariant)
--   - update holder body：diff old / new asset refs 同事务清失效
--
-- 没有 "draft" state：editor 内 owner 粘/拖图存浏览器内存，点 save 才一并
-- multipart 提交。owner 关浏览器 = 图根本没到 server。所以 orphan 不可能
-- 出现，不需要 scan / sweeper / GC。
--
-- 没 owner_id 列：归属链 asset → holder (post / wiki / ...) → 该实体的
-- owner_id；多一层 indirection 但去掉冗余。storage_key = '<holder_id>/<asset_id>'
-- 让 storage 也按 holder 分目录，prefix-list / batch-delete 同时方便。
CREATE TABLE assets (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_id          uuid          NOT NULL,
    storage_key        text          NOT NULL,
    content_type       text          NOT NULL DEFAULT 'application/octet-stream',
    size_bytes         bigint        NOT NULL DEFAULT 0,
    sha256             text          NOT NULL DEFAULT '',
    original_filename  text          NOT NULL DEFAULT '',
    created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX assets_holder_idx ON assets(holder_id);

-- writings —— owner 公开发表的"作品"（之前叫 posts；改名为更对位 owner
-- 内部叙事的 writing）。设计源自 claude.ai/design 的 essay 风格 (Stripe-
-- Press)。文章本身是 corpus document 的展开版：visitor chat retriever 可读
-- (uri='writing://<slug>')；private writing 通过 URI-glob ACL 走跟 wiki 同
-- 一套 corpus_permissions (InviteCode 的 path_pattern 匹 URI)。
--
-- body_md —— canonical 唯一存储格式，GitHub-flavored markdown。owner 在
-- admin Tiptap 编辑器里写（编辑器底层 round-trip markdown），MCP `writing_create`
-- 也只接 markdown，AI 原生吐什么我们就存什么。不发明 "block JSON" 中间态、
-- 不存 "格式标签"——单一形态，render 端 react-markdown + remark-gfm 直渲。
--
-- cover 是 typographic (大字 + sub + hue)，不上图也好看；可选 cover_image
-- _asset_id 后续支持真图 (落 assets 表)。
--
-- visibility: 'public' 或 'private'；private 在 URI-glob ACL 走 deny
-- 默认，特定 code 的 allow rule 放行。
--
-- read_minutes：denormalized 字段，Create/Update 时从 body_md 重算。原因是
-- list endpoint 不希望为每行算一遍 word count（也不想 ship body_md 给 list）。
--
-- published_at NULL = 草稿；NOT NULL = 已发布，前端公开 list 才显示。
CREATE TABLE writings (
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
    -- Obsidian sync 元数据。obsidian_source_path = import 时来自的 vault
    -- 内相对路径 (notes/x.md)；obsidian_imported_at = 那次 import 的时刻。
    -- 都是空 = 从未跟 vault 关联过。re-import 时根据 path 撞行决定 upsert
    -- 还是 skip（owner 在 web 改过的，updated_at > obsidian_imported_at →
    -- 保留 web 版本，避免覆盖 owner 后续编辑）。
    obsidian_source_path  text          NOT NULL DEFAULT '',
    obsidian_imported_at  timestamptz   NULL,
    published_at          timestamptz   NULL,
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX writings_owner_slug_uniq ON writings(owner_id, slug);
CREATE INDEX writings_owner_published_idx ON writings(owner_id, published_at DESC NULLS LAST);
CREATE INDEX writings_owner_path_idx ON writings(owner_id, path);

-- writing_refs —— writing 内 `[[slug]]` / `[[Title]]` 双链的边表。
--
-- body_md 里 owner 写 `[[X]]`，SaveWriting 同事务 resolve X 到目标 writing.id
-- (规则：先按 slug case-insensitive，没中再按 title fallback；都没中就
-- 不入边，render 那侧留原字面 [[X]] 当文字)。每次 save 走 "delete all
-- where src=this_writing → insert new" 重建 src 出度，简单不易漂。
--
-- 双向 lookup：(src) 出度跟 SaveWriting 共事务一起更新；(dst) 入度（=
-- backlinks）由 public /writings GET 时按 dst 查。
--
-- FK cascade ON DELETE：src 或 dst writing 删了 → 对应边自动消失。
-- src_writing_id = dst_writing_id 不阻止 ("self-link") —— 极少用，但不破坏 invariant。
CREATE TABLE writing_refs (
    src_writing_id  uuid          NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
    dst_writing_id  uuid          NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (src_writing_id, dst_writing_id)
);
CREATE INDEX writing_refs_dst_idx ON writing_refs(dst_writing_id);
CREATE INDEX writing_refs_owner_dst_idx ON writing_refs(owner_id, dst_writing_id);

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
    mode            text          NOT NULL,
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
                                    'smartrecruiters','workable',
                                    'jba','workday','bamboohr')),
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
-- 关键设计：PDF 永远 ephemeral —— 表里只存结构化数据，server 端不落任何
-- PDF 文件。owner 看预览是 admin 浏览器里的 React `ResumePage` 组件（同样
-- 用作 print 路由的源）；终稿 PDF 在 applications.commit 时由 gotenberg
-- sidecar 抓 print 路由现场渲染 bytes 塞 MCP 响应，Claude 拿去经 Playwright
-- MCP 投。
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

-- owner_calendar_connectors —— per-(owner, provider) OAuth state for the
-- "owner connects their calendar" admin connector flow. Self-hosted means
-- owner pastes their own Google Cloud OAuth client_id + client_secret in
-- admin UI (we never embed a global Anthropic/StandMeet OAuth client);
-- then click Authorize → Google consent → our /callback exchanges code
-- for tokens → we persist refresh_token long-term + access_token short-term.
--
-- All four credentials columns are cryptobox AES-256-GCM ciphertext
-- (KEK = INSTANCE_SECRET env)。Reads always decrypt to memory; never log.
-- Empty bytea = "not provided yet"。disconnect = DELETE the row（refresh
-- token revocation is a best-effort RPC; row goes whether revoke RPC ok or not）。
--
-- provider TEXT 是开放枚举: 第一版只 'google'，未来 'microsoft' 类似形状。
-- 单 owner 单 provider 只能存一条 row（UNIQUE (owner_id, provider)）。
CREATE TABLE owner_calendar_connectors (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    provider              text          NOT NULL,
    client_id_enc         bytea         NOT NULL DEFAULT '\x'::bytea,
    client_secret_enc     bytea         NOT NULL DEFAULT '\x'::bytea,
    access_token_enc      bytea         NOT NULL DEFAULT '\x'::bytea,
    refresh_token_enc     bytea         NOT NULL DEFAULT '\x'::bytea,
    -- access_token_expires_at —— 服务端按这个判断是否需要 refresh；提前
    -- 60s threshold 在 internal/gcal client 里写死，schema 不存。NULL = 没
    -- 拿到过 access_token (credentials saved but not yet authorized)。
    access_token_expires_at  timestamptz,
    scopes                jsonb         NOT NULL DEFAULT '[]'::jsonb,
    connected_at          timestamptz,
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX owner_calendar_connectors_owner_provider_uniq
    ON owner_calendar_connectors(owner_id, provider);

-- owner_booking_policy —— singleton-per-owner availability constraints
-- the agent must satisfy before placing a calendar.book event. Checked
-- before (and in addition to) Google FreeBusy: policy violations return
-- distinct error reasons so the chat agent can explain "outside hours" vs
-- "calendar busy" rather than a generic "couldn't book"。
--
-- min_lead_hours —— 距 now() 至少多少小时之后才允许 book (e.g. 24 = 至少
--                   提前 1 天)。0 = 没 lead-time 限制 (允许 in-hour book)。
-- allowed_weekdays —— 子集 of {'mon','tue','wed','thu','fri','sat','sun'}。
--                     空 array = 拒一切日期 (兜底，配 onboarding 强制非空 UI)。
-- working_hours_*  —— 'HH:MM' (24h) wall-clock 字符串 + owner timezone
--                     (owners.profile_timezone) 解释成 owner 本地时间。
--                     working_hours_start <= working_hours_end (跨午夜不
--                     支持，第一版假设 9-18 这种)。
-- buffer_min       —— 任何已存在 event 前后这么多分钟也算"占用"——比如
--                     buffer=15 时，10:30-11:00 的 event 让 10:15-11:15
--                     都拒 (freebusy 自然 conflict)。
CREATE TABLE owner_booking_policy (
    owner_id            uuid          PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    min_lead_hours      integer       NOT NULL DEFAULT 24,
    allowed_weekdays    text[]        NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri'],
    working_hours_start text          NOT NULL DEFAULT '09:00',
    working_hours_end   text          NOT NULL DEFAULT '18:00',
    buffer_min          integer       NOT NULL DEFAULT 15,
    updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- code_bookings —— append-only ledger of successfully placed calendar.book
-- events. One row per Google event inserted. Used to (a) count bookings per
-- code for quota gating (access_codes.max_bookings)；(b) provide an admin
-- audit view ("see what was booked off this code")；(c) future cancellation
-- path (delete event by id)。
--
-- code_id FK ON DELETE CASCADE —— revoke 一个 code，相关历史 booking 记录
-- 一并消失 (不影响 Google 那侧已经发出去的事件，那是 owner 自己 calendar 行为)。
--
-- google_event_id 是 google 那侧 events.id；google_html_link 持久保留是为
-- admin "open in Google Calendar" 链接，不再去查一次 API。
--
-- visitor_email NULL = visitor 没给 email (我们没把 visitor add 进 attendees)。
-- summary / start_at / end_at 是 audit 用，跟事件同步落盘 (insert 时 known)。
CREATE TABLE code_bookings (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code_id           uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    conversation_id   uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    google_event_id   text          NOT NULL,
    google_html_link  text          NOT NULL DEFAULT '',
    summary           text          NOT NULL DEFAULT '',
    start_at          timestamptz   NOT NULL,
    end_at            timestamptz   NOT NULL,
    visitor_email     citext,
    created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX code_bookings_code_idx ON code_bookings(code_id);
CREATE INDEX code_bookings_owner_idx ON code_bookings(owner_id, created_at DESC);
CREATE INDEX code_bookings_conv_idx ON code_bookings(conversation_id);

-- conversation_suggestions —— H.13.e: visitor 输入框 ghost text 的展示
-- + accept 日志。owner 在 admin conversation 详情页能看每 turn 推了哪条
-- ghost、visitor 有没有按 Tab 接受。
--
-- 写入路径:
--   - shown: visitor 浏览器渲 ghost (data-ghost 非空) → POST sessions/{id}/
--     suggestions/shown {ghost_text, source, turn_index}；server 落一行
--     accepted_at = NULL，返 row id
--   - accept: visitor 按 Tab → POST sessions/{id}/suggestions/{id}/accept
--     → server 把 accepted_at = now()
--
-- source: 'initial' 来自 code.suggested_questions (visitor 第一进 chat 时)
--         'followup' 来自 backend SSE `suggestions` 帧 (每轮 AI 答完追加)
--
-- ON DELETE CASCADE: conversation / owner 被删时整盘清掉；suggestion 没
-- 独立读价值。
CREATE TABLE conversation_suggestions (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    conversation_id   uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    turn_index        integer       NOT NULL DEFAULT 0,
    ghost_text        text          NOT NULL,
    source            text          NOT NULL,
    shown_at          timestamptz   NOT NULL DEFAULT now(),
    accepted_at       timestamptz
);

CREATE INDEX conversation_suggestions_conv_idx
    ON conversation_suggestions(conversation_id, shown_at);
CREATE INDEX conversation_suggestions_owner_idx
    ON conversation_suggestions(owner_id, shown_at DESC);

-- chat_reports —— I.3: visitor chat 走完 (或中途) 调 summarize_conversation
-- tool → AI 生成 HTML 报告，落这一行；每次调存一份 (允许重生)，session
-- 不 mark ended (跟老 /summary 的 ended_at 不同；新 tool 是 artifact 不
-- 是终态)。
--
-- html 是 AI 生成的完整 HTML body (含 <h1>/<ul>/<table>/<strong> 等)。前
-- 端在 sandboxed iframe 里渲，独立 /report/{id} 路由可直接打开。
--
-- ON DELETE CASCADE: conversation / owner 删一并清。
CREATE TABLE chat_reports (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    conversation_id   uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    html              text          NOT NULL,
    created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX chat_reports_conv_idx
    ON chat_reports(conversation_id, created_at DESC);
CREATE INDEX chat_reports_owner_idx
    ON chat_reports(owner_id, created_at DESC);
