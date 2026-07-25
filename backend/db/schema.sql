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
    -- recovery_hash —— #100 account recovery phrase 的 hash(只存 hash,明文只进邮件)。
    -- 空 = 没生成过 / 已用掉(单次)。锁在外面时 /recover 拿 email+phrase 对这列。
    recovery_hash        text          NOT NULL DEFAULT '',
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
    -- custom_css —— owner 自定义 CSS(Obsidian snippets sync / admin / MCP 任一面写)。存的是
    -- **sanitize + scope(.corpus-content)后**的安全版本;公开 reader 注入。user-provided → 攻击面。
    custom_css           text          NOT NULL DEFAULT '',
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

-- raw_entries 已删除:raw 折进 corpus_notes(genre='raw'，#151)。inbox 语义(inbox_source /
-- inbox_meta / flagged_private / archived / promoted_to)现是 corpus_notes 上的专属列;vault raw
-- 幂等靠 corpus_notes_inbox_source_uniq(见下)。

-- corpus_notes —— 统一的 vault note 基座。一张表容纳所有「笔记类」genre：wiki + output + subjectivity
-- + raw (genre='raw'，未整理摄入 inbox，靠 inbox_* 列区分) + writing (genre='writing'，owner 公开
-- 发表的"作品"，靠 slug / visibility / cover_* / read_minutes / cross_refs / published_at 列区分)。
-- writings 独立表 + writing_refs 已删(#151):作品折进本表,resolved [[X]] 边归一到 note_refs。
--   genre      —— 品类维度（'wiki' | 'output' | …）。ACL / retrieval / 寻址都带上它，加 genre 零建表。
--   parent_id   —— 树。地址（path）仍纯树派生（parent 链 + title slug，见 usecases.TreePaths），
--                  不存列：corpus 是 filesystem，路径来自它在哪个目录下。删父 → 子孙级联删。
--   source_ids  —— 「从哪提升来」的上游 id（wiki←raw ids / output←wiki ids）。归一原 wiki_entries 的
--                  source_raw_ids 与 output_entries 的 source_wiki_ids 为一列。
--   show_as_source —— false 时 AI 可 corpus_read 拿 body，但 readCollector 不收录（meta/persona）。
CREATE TABLE corpus_notes (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    genre           text          NOT NULL,
    parent_id        uuid          REFERENCES corpus_notes(id) ON DELETE CASCADE,
    title            text          NOT NULL,
    body             text          NOT NULL,
    tags             text[]        NOT NULL DEFAULT '{}',
    source_ids       uuid[]        NOT NULL DEFAULT '{}',
    show_as_source   bool          NOT NULL DEFAULT true,
    excerpt          text          NOT NULL DEFAULT '',
    published        bool          NOT NULL DEFAULT false,
    -- css_classes —— Obsidian `cssclasses` frontmatter:渲染时加到 note 容器的 CSS class(per-note
    -- 呈现钩子,配合 owner CSS snippet)。sync/admin/MCP 三面可写。
    css_classes      text[]        NOT NULL DEFAULT '{}',
    -- Obsidian vault sync 元数据(镜像 writings)。source_path = 来自的 vault 内相对路径
    -- (wiki/x.md);imported_at = 那次 sync 的时刻。reconcile 靠 source_path 认同一条,
    -- web-wins 靠 updated_at > imported_at 判断(owner 在 web 改过 → sync 不覆盖)。
    obsidian_source_path  text      NOT NULL DEFAULT '',
    obsidian_imported_at  timestamptz NULL,
    -- inbox fields —— only meaningful for genre='raw' (the ingest inbox folded into the one corpus
    -- structure, #151). inbox_source = 'mcp' | 'obsidian:<path>'; inbox_meta = arbitrary dump context;
    -- flagged_private / archived = inbox triage; promoted_to = the wiki note this raw was promoted into.
    -- Harmless defaults for every other genre (they never read them).
    inbox_source     text          NOT NULL DEFAULT '',
    inbox_meta       jsonb         NOT NULL DEFAULT '{}'::jsonb,
    flagged_private  boolean       NOT NULL DEFAULT false,
    archived         boolean       NOT NULL DEFAULT false,
    promoted_to      uuid          NULL,
    -- writing fields —— only meaningful for genre='writing' (the public "作品" reader folded into the
    -- one corpus structure, #151). Every other genre keeps the harmless defaults and never reads them.
    --   slug          —— per-owner stable identity; the public reader is /writings/<slug>, cross-links
    --                    resolve by slug, and the retriever URI is writing://writings/<slug>. Unlike the
    --                    tree-derived path of wiki/output, writing addressing is flat + slug-keyed, so the
    --                    slug is stored (path is NOT — it derives as "writings/"+slug in Go, same value as
    --                    before, so ACL / eval fixtures stay byte-identical).
    --   visibility    —— 'public' | 'private'; a bool can't hold the tri-shape (mode + locked_body teaser),
    --                    the public reader renders differently per mode → kept as text. published_at NULL =
    --                    draft; the shared `published` bool mirrors (published_at IS NOT NULL).
    --   cross_refs    —— the owner-authored [[X]] slug list (input side); the RESOLVED edges live in the
    --                    note_refs edge table (writing_refs was folded into it, #151). Kept distinct.
    slug             text          NOT NULL DEFAULT '',
    visibility       text          NOT NULL DEFAULT 'public',
    locked_body      text          NOT NULL DEFAULT '',
    cover_headline   text          NOT NULL DEFAULT '',
    cover_hue        text          NOT NULL DEFAULT 'amber',
    -- FK to assets(id) added via ALTER after the assets table (assets is declared later in this file).
    cover_image_asset_id  uuid     NULL,
    read_minutes     int           NOT NULL DEFAULT 0,
    cross_refs       text[]        NOT NULL DEFAULT '{}',
    published_at     timestamptz   NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX corpus_notes_owner_genre_idx ON corpus_notes(owner_id, genre);
CREATE INDEX corpus_notes_parent_idx ON corpus_notes(parent_id);
CREATE INDEX corpus_notes_source_path_idx ON corpus_notes(owner_id, obsidian_source_path);
-- raw inbox idempotency: one row per (owner, inbox_source) for vault-sourced raw (re-upload = upsert).
CREATE UNIQUE INDEX corpus_notes_inbox_source_uniq
  ON corpus_notes (owner_id, inbox_source) WHERE genre = 'raw' AND inbox_source LIKE 'obsidian:%';
-- writing slug uniqueness: per-owner unique slug for genre='writing' (mirrors old writings_owner_slug_uniq).
CREATE UNIQUE INDEX corpus_notes_writing_slug_uniq
  ON corpus_notes (owner_id, slug) WHERE genre = 'writing';
-- writing published listing / infinite-scroll cursor (mirrors old writings_owner_published_idx).
CREATE INDEX corpus_notes_writing_published_idx
  ON corpus_notes (owner_id, published_at DESC NULLS LAST) WHERE genre = 'writing';

-- note_refs —— corpus_notes 跨-genre `[[Title]]` 双链边表。src/dst 现指向 corpus_notes（genre='wiki'）。
-- body 里 owner 写 `[[X]]`，PromoteToWiki / UpdateWiki 同事务 resolve X 到目标 note.id（wiki 无
-- slug，只按 title case-insensitive；没中就不入边）。每次写走 "delete all where src → insert new"。
-- 出度 = read-next（引用了哪些）；入度（按 dst）= cited-by backlinks。FK cascade：note 删 → 边消。
-- （note_refs 的跨-genre 归一在后续 refs 统一阶段；本阶段仅把 FK 重指到统一表。）
CREATE TABLE note_refs (
    src_id  uuid          NOT NULL REFERENCES corpus_notes(id) ON DELETE CASCADE,
    dst_id  uuid          NOT NULL REFERENCES corpus_notes(id) ON DELETE CASCADE,
    owner_id     uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (src_id, dst_id)
);
CREATE INDEX note_refs_dst_idx ON note_refs(dst_id);
CREATE INDEX note_refs_owner_dst_idx ON note_refs(owner_id, dst_id);

CREATE TABLE media_assets (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    kind            text          NOT NULL,
    filename        text          NOT NULL,
    mime_type       text          NOT NULL,
    size_bytes      bigint        NOT NULL DEFAULT 0,
    storage_key     text          NOT NULL,
    -- raw note 现同住 corpus_notes（genre='raw'）；FK 重指统一表（raw_entries 已删）。
    raw_entry_id    uuid          REFERENCES corpus_notes(id) ON DELETE SET NULL,
    -- wiki/output note 现同住 corpus_notes（genre 区分），两列都 FK 统一表；哪列有值由
    -- 上层按 note genre 决定（未来可归一成单 note_id 列）。
    wiki_entry_id   uuid          REFERENCES corpus_notes(id) ON DELETE SET NULL,
    output_entry_id uuid          REFERENCES corpus_notes(id) ON DELETE SET NULL,
    created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Access codes —— owner 发给访客的访问码 (LABEL-XXX 格式)；一码多人共用。
-- corpus_permissions：path-glob ACL，first-match-wins by order ascending，
--                     default deny。空列表 → 全允许 (无 ACL = 允许全部)。
--                     形状：[{"action": "allow"|"deny", "path_pattern": "...", "order": n}]。
-- access_codes —— 访客访问码。A.3-IAM 起所有 ACL / capability gating 都从
-- assumed_role_id 指向的 Role 推断（[[role_snapshot]] 在 session issue 时
-- freeze）；不再有 corpus_permissions / granted_skills / code_skills /
-- code_mcp_servers 这些散落字段。#135:per-code 预约配额也不在这——booker 能力
-- 自管(它的隔离 capstore),内核 access_codes 不认。
CREATE TABLE access_codes (
    id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                  uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code                      citext        UNIQUE NOT NULL,
    label                     text          NOT NULL,
    purpose                   text          NOT NULL DEFAULT '',
    ghosts       jsonb         NOT NULL DEFAULT '[]'::jsonb,
    expires_at                timestamptz,
    status                    text          NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active', 'revoked')),
    max_turns_per_session     integer,
    -- max_members —— 这张码最多容纳几个不同名字(member)。NULL = 不限。满了
    -- 之后新名字被拒(visitor 见 "code 已满");已有名字照常继续。匿名(skip)
    -- 也各占一个名额。
    max_members               integer,
    -- require_ghost_evidence —— F-A-10 的 **per-code 覆盖**(nullable):NULL = 继承 role 的开关;
    -- true/false = 这张码显式覆盖。合并在 session 装配层(code 非 NULL 则用 code,否则用 role),
    -- 冻进 RoleSnapshot。语义同 role 列:开 → 空证据的非终点 waypoint 不当 steering ghost。
    require_ghost_evidence     boolean,
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
    -- enabled —— owner 全局开关。false = agent 永不拿到该 skill(即使挂在 role 上)。
    -- ListRoleSkills 据此过滤;owner 不必从每个 role 解绑就能临时停用一个 skill。
    enabled         bool          NOT NULL DEFAULT true,
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
    -- granted_deps —— owner 显式授权这个 ext-mcp server 可接的 connector 依赖名
    -- （"calendar" / "smtp"…）。ext-mcp 是最低信任（别人写的进程，owner 只是注册了
    -- URL），其工具即便声明 Requires:[calendar] 且 calendar 已连，默认也**不**注入句柄
    -- （连接器句柄带 owner 权限，自动给任意注册 server 等于把 owner 账号借出去）。owner
    -- 把某个 dep 加进这里 = 显式同意，工具才解析暴露。空 = 一个都不授权（默认拒）。
    granted_deps            text[]        NOT NULL DEFAULT '{}',
    created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mcp_servers_owner_name_uniq ON mcp_servers(owner_id, name);

-- prompts —— owner-scoped persona/instruction 片段库。
-- 设计 [[iam-role-pivot-plan]]：type 通用命名，挂 role 后语义角色叫"role
-- prompt"，但 type 本身不带这个限定（未来 skill / page 也可能复用同张表）。
-- builtin（is_builtin=true）现在只有一行 "public" —— claim 时种，删除被
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
-- public role：claim 时种，is_builtin=true，公开 corpus URIs / 无 skill /
--   无 mcp / prompt 挂 public prompt；不可删（repo 层拒）。owner 不显式
--   选 role 时 access_code 默认挂这条。
CREATE TABLE roles (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name         text          NOT NULL,
    description  text          NOT NULL DEFAULT '',
    -- greeting —— 访客在名字选择器看到的「这是什么」介绍(per-role,owner 可改)。
    -- 空 = picker 用按 owner handle 拼的默认。
    greeting     text          NOT NULL DEFAULT '',
    prompt_id    uuid          REFERENCES prompts(id) ON DELETE SET NULL,
    is_builtin   boolean       NOT NULL DEFAULT false,
    -- notify_owner_on_booking —— #130: 这个 role 下的访客约成后,给 owner 自己发一封
    -- owner 视角的通知邮件(per-role 开关,owner 设)。默认关。
    notify_owner_on_booking boolean NOT NULL DEFAULT false,
    -- dock_buttons —— #109/#110 这个 role 的 ≤2 个 chat dock 按钮：[{capability_id, trigger}]。
    -- 访客点按钮 = 发触发词（快捷方式）。冻进 RoleSnapshot；title 解析 + code-deny 过滤在会话装配层。
    dock_buttons jsonb         NOT NULL DEFAULT '[]'::jsonb,
    -- require_ghost_evidence —— F-A-10: 开则「内容型引导 ghost」只提有 evidence_refs 的 waypoint;
    -- 空证据的**非终点** waypoint 不当 steering ghost 提出(prompt 规则6从"写着不强制"变成真强制)。
    -- **终点/工具 waypoint(预约)不受影响,永远可提**(它们本就没语料证据)。per-role,code 可覆盖。
    require_ghost_evidence boolean NOT NULL DEFAULT false,
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

-- role_waypoints —— ghost-steering: owner 在 role 上写的引导目的地(waypoint)。跟 role_corpus_uris
-- 一样是 role 的 join；session freeze 时随 RoleSnapshot 冻结,且 evidence_refs 逐条过 role 授权 glob,
-- 全越界的 waypoint 在冻结那刻整条丢弃(feasibility floor)。waypoint_id 是 owner 写的 slug(heading tag)。
-- code_waypoints —— ghost-steering 目的地的 **per-code 覆盖层**（mirrors role_waypoints）。
-- role 是「这个受众」的目的地；code 是「这一次邀约」的。合并语义（domain.MergeWaypoints）：
-- 同 waypoint_id → code 整条覆盖 role 的，新 id → 追加；code 不配 → 完全继承 role 的。
-- 冻结那刻仍过 FilterWaypointsByCorpus —— code 不能借覆盖引向 role 看不见的证据。
CREATE TABLE code_waypoints (
    code_id       uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    waypoint_id   text          NOT NULL,
    description   text          NOT NULL,
    weight        integer       NOT NULL DEFAULT 1,
    evidence_refs jsonb         NOT NULL DEFAULT '[]'::jsonb,
    is_terminal   boolean       NOT NULL DEFAULT false,
    PRIMARY KEY (code_id, waypoint_id)
);

CREATE TABLE role_waypoints (
    role_id       uuid          NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    waypoint_id   text          NOT NULL,
    description   text          NOT NULL,
    weight        integer       NOT NULL DEFAULT 1,
    evidence_refs jsonb         NOT NULL DEFAULT '[]'::jsonb,
    is_terminal   boolean       NOT NULL DEFAULT false,
    PRIMARY KEY (role_id, waypoint_id)
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
-- 不显式选 = 上层 usecase 默认绑 owner 的 public role。
ALTER TABLE access_codes
    ADD COLUMN assumed_role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT;

-- access_codes.prompt_id —— #104 per-code prompt：这张码自带一份集中管理的 prompt
-- (引 prompts 库，跟 roles.prompt_id 同款)。session freeze 时把它的 body 冻进
-- RoleSnapshot.code_prompt_body，persona 在 role persona 之后**叠加**它。可选；
-- 删 prompt → SET NULL(码继续用，只是没那段 per-code persona)。
ALTER TABLE access_codes
    ADD COLUMN prompt_id uuid REFERENCES prompts(id) ON DELETE SET NULL;

-- access_codes.inline_prompt —— #104 扩展：per-code prompt 的**内联**形态。跟 prompt_id 二选一：
-- 内联非空 → 冻进 RoleSnapshot.code_prompt_body（优先于 prompt_id 库引用）；空 → 走 prompt_id。
-- 给"发码方随码带一段 persona 上下文、又不想污染 owner 的 prompt 库"用（job-loop 发 app-码时把
-- recruiter 应聘身份写这里 —— core 无脑注入，不知道内容语义、不反查 application）。
ALTER TABLE access_codes
    ADD COLUMN inline_prompt text NOT NULL DEFAULT '';

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

-- writing note 现同住 corpus_notes（genre='writing'）；cover_image_asset_id FK 重指 assets（writings 已删，
-- #151）。assets 在本文件后于 corpus_notes 声明,故 FK 在此 ALTER 补挂(不能在建表处前向引用)。
ALTER TABLE corpus_notes
    ADD CONSTRAINT corpus_notes_cover_asset_fk
    FOREIGN KEY (cover_image_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- writings 表已删除:owner 公开发表的"作品"折进 corpus_notes(genre='writing'，#151)。writing 专属语义
-- (slug / visibility / locked_body / cover_* / read_minutes / cross_refs / published_at)现是 corpus_notes
-- 上的专属列;body_md→body, path 不存(派生 "writings/"+slug), obsidian 元数据复用共享列。slug 唯一 +
-- published 列表索引见 corpus_notes 建表处的 partial index。

-- writing_refs —— writing 内 `[[slug]]` / `[[Title]]` 双链的边表。src/dst 现指向 corpus_notes(genre=
-- 'writing')（writings 表已删，#151）。
--
-- body 里 owner 写 `[[X]]`，SaveWriting 同事务 resolve X 到目标 note.id (规则：先按 slug case-
-- insensitive，没中再按 title fallback；都没中就不入边，render 那侧留原字面 [[X]] 当文字)。每次 save
-- 走 "delete all where src=this_writing → insert new" 重建 src 出度，简单不易漂。
--
-- 双向 lookup：(src) 出度跟 SaveWriting 共事务一起更新；(dst) 入度（= backlinks）由 public /writings GET
-- 时按 dst 查（只列 published 的源）。
--
-- FK cascade ON DELETE：src 或 dst note 删了 → 对应边自动消失。
CREATE TABLE writing_refs (
    src_writing_id  uuid          NOT NULL REFERENCES corpus_notes(id) ON DELETE CASCADE,
    dst_writing_id  uuid          NOT NULL REFERENCES corpus_notes(id) ON DELETE CASCADE,
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
    started_at      timestamptz   NOT NULL DEFAULT now(),
    last_at         timestamptz   NOT NULL DEFAULT now(),
    -- summary / report 是独立的 chat_reports 表(一会话一份),不挂 conversations 行。
    -- client_ip：访客创建会话时的来源 IP（chi.RealIP 解出的 host，去 port）。
    -- 给 owner「IP 感知」用：admin conversations 列表展示，配合 banned_ips 封禁。
    -- 空串 = 未知（老行 / 拿不到）。存 text 而非 inet：对畸形值宽容，不让一条
    -- 怪 header 把会话创建整崩。
    client_ip       text          NOT NULL DEFAULT '',
    -- doc_key：这段对话属于哪个 surface。'' = 主聊天（首页 Hero）；否则 = 访客
    -- 当时所在 doc 的 path（如 'projects/lucerna'）。一个 member 可以有多段对话：
    -- 主聊天一段 + 每篇 doc 的浮窗各一段，transcript 彼此独立。turn 配额仍按 member
    -- 汇总（共享预算），「互通」靠 AI 读该 member 全部对话实现。
    doc_key         text          NOT NULL DEFAULT ''
);

-- 一个 member 每个 surface（doc_key）唯一一段对话，让 find-or-create 幂等。
-- 对话不会结束（生成 summary 不封口），所以一个 member+surface 永远续同一段。
CREATE UNIQUE INDEX conversations_member_dockey_open_uniq
    ON conversations(member_id, doc_key)
    WHERE member_id IS NOT NULL;

-- dialogs —— 一轮「人问 + AI 答」= 一个 dialog（中间分组层）。内容留在 messages（每个 dialog
-- 恰好 2 条：role='visitor' 的 Q + role='assistant' 的 A）；dialog 只给这一轮一个身份/时序锚点
-- （曾经 AppendDialog 借 assistant message id 冒充 dialog id，现在有真 id）。未来 backlinks /
-- per-dialog 操作用它的 id。turn count 仍数 visitor message（每 dialog 一条），语义不变。
CREATE TABLE dialogs (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX dialogs_conversation_idx ON dialogs(conversation_id);

CREATE TABLE messages (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    -- dialog_id：这条 message 属于哪一轮。级联链 conversation → dialogs → messages（删会话，
    -- dialog 与 message 一起走）。conversation_id 保留（现有 transcript/count 直读，且给一条
    -- 独立的 CASCADE 路径），两条 CASCADE 都指向删除，不冲突。
    dialog_id        uuid          NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,
    role             text          NOT NULL,
    body             text          NOT NULL,
    tool_calls       jsonb,
    cited_wiki_ids   uuid[]        NOT NULL DEFAULT '{}',
    cited_output_ids uuid[]        NOT NULL DEFAULT '{}',
    -- cited_subjectivity_ids：本轮引用且被 owner opt-in（show_as_source=true）的 subjectivity
    -- 笔记。subjectivity 默认私有（不引用）；仅 opt-in 的进这里，走 subjectivity_refs 展示。
    cited_subjectivity_ids uuid[]  NOT NULL DEFAULT '{}',
    -- cited_writing_ids：本轮引用的 writing（公开发布内容，读了就引，无 show_as_source gate）。
    cited_writing_ids uuid[]       NOT NULL DEFAULT '{}',
    created_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX messages_dialog_idx ON messages(dialog_id);

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
    site_title      text          NOT NULL DEFAULT '',
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

-- owner_calendar_connectors RETIRED (#155/#190) — the pre-#155 gcal-specific OAuth table was
-- superseded by the generic owner_connectors table below; its repo (CalendarRepo) is deleted.
-- Kept out of fresh installs; existing volumes keep the empty table (harmless).

-- owner_mail_connectors —— per-(owner, provider) outbound SMTP credentials so
-- the owner can send mail (today: the access-code email when a gate request is
-- approved). provider is 'smtp' in v1; the row holds the owner's own SMTP server
-- (Gmail app-password / Postmark / Fastmail / …) — self-hosted, no third-party
-- SaaS binding. username + password are encrypted at rest (cryptobox, like the
-- calendar client_secret); host/port/from are not secret. connected_at is set
-- once a test send succeeds (proves the creds work) — NULL = saved-but-untested.
CREATE TABLE owner_mail_connectors (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    provider      text          NOT NULL DEFAULT 'smtp',
    host          text          NOT NULL,
    port          integer       NOT NULL,
    username_enc  bytea         NOT NULL DEFAULT '\x'::bytea,
    password_enc  bytea         NOT NULL DEFAULT '\x'::bytea,
    from_address  text          NOT NULL,
    from_name     text          NOT NULL DEFAULT '',
    connected_at  timestamptz,
    -- email-OTP verification: a 6-digit code is emailed to from_address; the
    -- owner must echo it back to prove they actually receive mail (not just that
    -- the SMTP creds accept a send). otp_hash is sha256(code); cleared on success
    -- or after otp_attempts hits the cap. connected_at is set only on a match.
    otp_hash      bytea,
    otp_expires_at timestamptz,
    otp_attempts  integer       NOT NULL DEFAULT 0,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX owner_mail_connectors_owner_provider_uniq
    ON owner_mail_connectors(owner_id, provider);

-- owner_connectors —— #155 统一连接器**连接状态**表（替代 owner_calendar_connectors +
-- owner_mail_connectors；归一化：任意 kind / 任意品类的连接器一张表）。这里只存「这个 owner
-- 连了哪些连接器、凭据/token 是什么、连没连、哪个是品类槽的 active」——连接器的**定义**
-- (spec+binding / protocol)不在这：内置来自仓库里的 bundled manifest 文件、上传的另存。
--
-- credentials_enc —— 加密 JSON，按 kind 解：openapi oauth2 {client_id,client_secret} /
--                    openapi apiKey {key} / protocol smtp {host,port,username,password,
--                    from_address,from_name,tls}。凭据只在 connector 层解密，永不进 usecases。
-- token_enc       —— 加密 JSON {access_token,refresh_token}（仅 openapi oauth2）。
-- token_expires_at—— 服务端据此判断是否 refresh；NULL = 还没拿到 token（存了 creds 未授权）。
-- connected_at    —— 非空 = 已连/已验（oauth 走完 dance / protocol 验证通过）。
-- active          —— 一个品类槽同时只一个 active 连接器（§9 槽位规则）；owner 显式 activate。
CREATE TABLE owner_connectors (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    connector_id     text          NOT NULL,
    category         text          NOT NULL,
    kind             text          NOT NULL,
    credentials_enc  bytea         NOT NULL DEFAULT '\x'::bytea,
    token_enc        bytea         NOT NULL DEFAULT '\x'::bytea,
    token_expires_at timestamptz,
    scopes           jsonb         NOT NULL DEFAULT '[]'::jsonb,
    connected_at     timestamptz,
    active           boolean       NOT NULL DEFAULT false,
    -- uploaded (openapi) connectors carry their own spec + JSONata binding (built-ins leave these
    -- empty — their manifest comes from go:embed data). auth_scheme = owner-picked securityScheme.
    spec             bytea         NOT NULL DEFAULT '\x'::bytea,
    binding          bytea         NOT NULL DEFAULT '\x'::bytea,
    auth_scheme      text          NOT NULL DEFAULT '',
    -- protocol (caldav/smtp/…) for kind=protocol connectors owner-created in the UI (no spec).
    protocol         text          NOT NULL DEFAULT '',
    -- expose this openapi connector's raw operations as per-session agent tools (§3 agent 路).
    expose_as_agent_tools boolean   NOT NULL DEFAULT false,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX owner_connectors_owner_connector_uniq
    ON owner_connectors(owner_id, connector_id);

-- owner_booking_policy —— singleton-per-owner availability constraints
-- the agent must satisfy before placing a calendar.book event. Checked
-- before (and in addition to) Google FreeBusy: policy violations return
-- distinct error reasons so the chat agent can explain "outside hours" vs
-- "calendar busy" rather than a generic "couldn't book"。
--
-- min_lead_days —— 距 now() 至少多少天之后才允许 book (e.g. 2 = 至少提前
--                   2 天)。正整数 (owner UI 强制 ≥1)；恒正保证永远不会 book
--                   到过去 / 太近的时段。
-- allowed_weekdays —— 子集 of {'mon','tue','wed','thu','fri','sat','sun'}。
--                     空 array = 拒一切日期 (兜底，配 onboarding 强制非空 UI)。
-- working_hours_*  —— 'HH:MM' (24h) wall-clock 字符串 + owner timezone
--                     (owners.profile_timezone) 解释成 owner 本地时间。
--                     working_hours_start <= working_hours_end (跨午夜不
--                     支持，第一版假设 9-18 这种)。
-- buffer_min       —— 任何已存在 event 前后这么多分钟也算"占用"——比如
--                     buffer=15 时，10:30-11:00 的 event 让 10:15-11:15
--                     都拒 (freebusy 自然 conflict)。
-- #135: owner_booking_policy + code_bookings tables RETIRED — booking policy + bookings now live
-- in booker's isolated capstore (mcp_calendar_book schema). Kept out of fresh installs; existing
-- volumes keep the empty tables (harmless).

-- capability_settings —— Phase H / P.6+P.7: per-(owner, capability) 的 owner-enable
-- 开关。只存「被 owner 显式关掉」的偏好；没有行 = 默认开（builtin 出厂即可见）。
-- capability_id 是 registry 的 dotted ID（corpus.retrieval / calendar.book / …）或
-- owner-origin entry 的 ID。enabled=false 时该 capability 的 tool 不进访客 session
-- （owner_enabled 闸，对 builtin 也生效；builtin 可关不可删，P.7）。
-- (owner_id, capability_id) 唯一 → upsert 安全（并发 toggle 不串）。
CREATE TABLE capability_settings (
    owner_id      uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    capability_id text          NOT NULL,
    enabled       boolean       NOT NULL DEFAULT true,
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, capability_id)
);

-- code_capability_denials / code_skill_denials —— ACL hierarchy 的 code 层
-- (docs/design/capability-acl-hierarchy.md)。纯 AND·code-deny：code 从所选 role
-- 授的集合里**再砍**(只减不加)。presence=deny，无 state 列；无行=完全继承 role
-- (向后兼容，老 code 零 deny)。issue 时跟 role grant 相减(ResolveACL)再冻进
-- RoleSnapshot。capability_id 是 registry id(非表，无 FK，同 capability_settings)；
-- skill_id 是 skills 行(有 FK)。
-- code_corpus_denials —— corpus 准入的 **per-code 收窄层**（ACL 三层的第三类；capability/skill 已有，
-- corpus 之前缺席）。role 授的是「这个受众」能读的正列表；一张码可以再减 ——「这次邀约」不该看的。
--
-- 纯减法，跟 capability/skill 的 deny 集同构：readable = role 的 glob 命中 AND 没被本码的 deny 命中。
-- 只减不加（code 开不了 role 没给的），所以是集合交、**无序**，不引入 first-match-wins 的顺序敏感
-- （capability-acl-hierarchy A.2 当初 defer 的正是那个；而 A.4 已把整层定成纯 AND）。
--
-- 单位是 glob 而非 note id：跟 role 的正列表同一种语言，owner 写 `subjectivity://cv` 就少一条，
-- 写 `subjectivity://**` 就把整个 genre 从这张码上收回。
CREATE TABLE code_corpus_denials (
    code_id     uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    uri_pattern text NOT NULL,
    PRIMARY KEY (code_id, uri_pattern)
);

CREATE TABLE code_capability_denials (
    code_id       uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    capability_id text NOT NULL,
    PRIMARY KEY (code_id, capability_id)
);

CREATE TABLE code_skill_denials (
    code_id   uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    skill_id  uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (code_id, skill_id)
);

CREATE INDEX code_skill_denials_skill_idx ON code_skill_denials(skill_id);

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
-- code_bookings RETIRED (#135) — see the note at owner_booking_policy above; bookings live in
-- booker's capstore now.

-- conversation_ghosts —— H.13.e: visitor 输入框 ghost text 的展示
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
-- source: 'initial' 来自 code.ghosts (visitor 第一进 chat 时)
--         'followup' 来自 backend SSE `suggestions` 帧 (每轮 AI 答完追加)
--
-- ON DELETE CASCADE: conversation / owner 被删时整盘清掉；suggestion 没
-- 独立读价值。
CREATE TABLE conversation_ghosts (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    conversation_id   uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    turn_index        integer       NOT NULL DEFAULT 0,
    ghost_text        text          NOT NULL,
    source            text          NOT NULL,
    -- ghost-steering: policy 出的 ghost 带 heading tag(target_waypoint)+ coherence hook(follows_from)。
    -- 静态 initial ghost 这两列为 NULL；source='policy' 才填。
    target_waypoint   text,
    follows_from      text,
    shown_at          timestamptz   NOT NULL DEFAULT now(),
    accepted_at       timestamptz
);

CREATE INDEX conversation_ghosts_conv_idx
    ON conversation_ghosts(conversation_id, shown_at);
CREATE INDEX conversation_ghosts_owner_idx
    ON conversation_ghosts(owner_id, shown_at DESC);

-- chat_reports —— I.3: visitor chat 走完 (或中途) 调 summarize_conversation
-- tool → AI 生成 HTML 报告，落这一行。#129 一会话一份:conversation_id UNIQUE，
-- 第二次 summarize upsert 改写原行 (revise)，report_id 稳定、不 append 出重复报告。
-- session 不 mark ended (新 tool 是 artifact，不是终态)。
--
-- html 是 AI 生成的完整 HTML body (含 <h1>/<ul>/<table>/<strong> 等)。前
-- 端在 sandboxed iframe 里渲，独立 /report/{id} 路由可直接打开。
--
-- ON DELETE CASCADE: conversation / owner 删一并清。
CREATE TABLE chat_reports (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    conversation_id   uuid          NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    html              text          NOT NULL,
    created_at        timestamptz   NOT NULL DEFAULT now()
);

-- conversation_id UNIQUE 自带查询索引，原 (conversation_id, created_at) 复合索引冗余，删掉。
CREATE INDEX chat_reports_owner_idx
    ON chat_reports(owner_id, created_at DESC);

-- inference_usage —— #106 计费:每次 owner-key LLM 调用记一行 {model, input/output tokens}。
-- BYOAI 是访客自付,不记(route handler 传 no-op recorder)。7 天小表:查询窗口固定 7 天,
-- boot 时清 >7 天的老行(见 usecases.CleanupInferenceUsage)。admin /inference-usage 出按天×model 聚合。
CREATE TABLE inference_usage (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    model          text          NOT NULL,
    input_tokens   integer       NOT NULL,
    output_tokens  integer       NOT NULL,
    created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX inference_usage_owner_time_idx
    ON inference_usage(owner_id, created_at DESC);

-- banned_ips —— owner 封掉的来源 IP。命中的 IP 在公开 /api/v1 面被 403 挡掉
-- (visitor chat / session / access-request 全拒)。ip 存 text 精确匹配
-- chi.RealIP 解出的 host (跟 conversations.client_ip 同口径)。reason 给 owner
-- 自己记备注。expires_at NULL = 永久封；非空 = 到点自动失效 (enforcement
-- 查询带 now() 过滤)。单 owner v1 仍带 owner_id，多租户免费继承。
CREATE TABLE banned_ips (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    ip          text          NOT NULL,
    reason      text          NOT NULL DEFAULT '',
    expires_at  timestamptz,
    created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX banned_ips_owner_ip_uniq ON banned_ips(owner_id, ip);

-- mcp_app_state —— MCP App（ui:// 沙箱卡）的跨刷新状态。卡是「能跨刷新存活的小应用」，
-- 经 host 对自己 mcp 那一格做增删改查。挂在 session 背后的耐久身份 member 上，按能力
-- （=mcp，capreg capability id，如 calendar.book / corpus.retrieval）分格；mcp_id 由后端
-- 从 tool 派生（绝不收客户端值）→ 同 mcp 跨 session 隔离、同 session 跨 mcp 隔离。value
-- 是 app 自定义 jsonb（booked 卡存 {event_id: {cancelled:true}}）。member 删（会员清理）
-- 级联清掉其全部 app state。单 owner v1 仍带 owner_id，多租户免费继承。
CREATE TABLE mcp_app_state (
    owner_id   uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    member_id  uuid        NOT NULL REFERENCES code_members(id) ON DELETE CASCADE,
    mcp_id     text        NOT NULL,
    state_key  text        NOT NULL,
    value      jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, mcp_id, state_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- API-key facade (facade-directions.md) —— the outward, non-agentic, role-scoped
-- programmatic surface. An api_key is "a code minus the brain and the gas": it
-- assumes a role exactly like an access_code, but its holder calls capabilities as
-- HTTP endpoints (no LLM, no turn/session quota) — bounded only by rate limiting.
-- Deliberately PARALLEL to access_codes (+ its denial tables), not a refactor of
-- the settled codes infra.
-- ─────────────────────────────────────────────────────────────────────────────

-- api_keys —— one issued programmatic key. secret_hash is sha256 of the full
-- `smk_…` secret (shown once at mint; never stored raw). prefix is the display
-- stub. assumed_role_id NOT NULL (same as codes) scopes corpus + capabilities.
-- rate_limit_rpm NULL = instance default. #135: no booking quota lives here —
-- api-key sessions carry no access code, so the booker quota gate (keyed by
-- code) never applied to them; booking config is the booker capability's own.
CREATE TABLE api_keys (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    assumed_role_id uuid        NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    label           text        NOT NULL,
    prefix          text        NOT NULL,
    secret_hash     bytea       NOT NULL,
    rate_limit_rpm  integer,
    status          text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'revoked')),
    expires_at      timestamptz,
    last_used_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX api_keys_secret_hash_idx ON api_keys(secret_hash);
CREATE INDEX api_keys_owner_idx ON api_keys(owner_id);

-- api_key_capability_denials / api_key_skill_denials —— per-key deny rows, mirror
-- of code_capability_denials / code_skill_denials: pure subtraction from the
-- assumed role's grant.
CREATE TABLE api_key_capability_denials (
    key_id        uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    capability_id text NOT NULL,
    PRIMARY KEY (key_id, capability_id)
);

CREATE TABLE api_key_skill_denials (
    key_id   uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (key_id, skill_id)
);

CREATE INDEX api_key_skill_denials_skill_idx ON api_key_skill_denials(skill_id);

-- api_open_capabilities —— the candidacy ("open") gate. A capability is an API
-- candidate only once the owner opens it here; opening exposes nothing by itself
-- (a key whose role grants it must also exist). Runtime owner data, distinct from
-- the dev-time KnownAPIGaps ratchet (which tracks renderer completeness).
CREATE TABLE api_open_capabilities (
    owner_id      uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    capability_id text        NOT NULL,
    opened_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, capability_id)
);
