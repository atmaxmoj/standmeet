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

-- corpus_searchable —— a note's body with the language switcher taken out, for search only.
--
-- The vault's i18n contract puts a row of radio buttons inside the `> [!i18n]` block, above the
-- language panes. It is Obsidian's presentation — this product renders its own switcher — and the
-- Go parser that reads the contract already drops that line (corpus/i18n/parse.go: a line inside
-- the block but outside any pane). Search never saw that decision: it reads `body` straight, so
-- the switcher's *button text* ("EN", "中文") is indexed as if the owner had written it. Searching
-- 中文 returned every multilingual note, and every snippet opened with EN 中文 before its first
-- real word (UX-78).
--
-- Why the cleaning happens here and not in Go: `ts_headline` strips HTML before the fragment ever
-- reaches us, so by then the tags are gone and only their text is left — indistinguishable from
-- prose. The line has to go before postgres reads it.
--
-- Deliberately narrow: a line is dropped only when it carries one of the switcher's own tags.
-- `<` alone would eat mathematics (`a < b` is prose in this corpus), and dropping tags rather than
-- the whole line is what leaves the orphan button text behind.
--
-- The block's own markers go the same way — `> [!i18n]` and `> > [!lang] zh` are the contract's
-- scaffolding, and a search hit near one used to open with a bare "en" or "zh" (the fragment
-- window can start in the middle of a marker, so cleaning the fragment afterwards never sees
-- enough of it to recognise). Only these two markers: `[!tip] Something` carries a title the
-- owner wrote, and dropping that line would lose content.
CREATE FUNCTION corpus_searchable(body text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN regexp_replace(
        regexp_replace(body, '(?in)^.*</?(label|input)[ />].*$', '', 'g'),
        '(?in)^[ \t>]*\[!(i18n|lang)\][+-]?[ \t]*[a-z-]*[ \t]*$', '', 'g');

-- Owners —— v1 单 owner（instance_settings.multi_tenant=false 锁定）；
-- 但 schema 已经按 multi-tenant 形状建（每张领域表都会带 owner_id FK）。
CREATE TABLE owners (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    email                citext        UNIQUE NOT NULL,
    password_hash        text          NOT NULL,
    -- recovery_hash —— #100 account recovery phrase 的 hash(只存 hash,明文只进邮件)。
    -- 空 = 没生成过 / 已用掉(单次)。锁在外面时 /recover 拿 email+phrase 对这列。
    recovery_hash        text          NOT NULL DEFAULT '',
    -- pending_email —— 待确认的新邮箱。email 这一列同时是登录身份**和**恢复渠道,
    -- 所以它不再当场搬走:新地址先落这里,寄一封确认信,点开了才换过去。
    -- pending 期间恢复短语仍寄旧地址 —— 新地址还没被证明,把救命通道交给它等于把洞挪个位置。
    -- 不加 UNIQUE:待确认的地址还不是身份,不该占命名空间。
    pending_email            citext,
    -- 只存 hash,跟 recovery_hash / setup_token_hash 一个姿势:明文只进那封邮件。
    -- 一次性靠确认时清空这三列实现 —— 可重放的确认链接 = 把身份挂在一封旧邮件上。
    pending_email_token_hash text          NOT NULL DEFAULT '',
    pending_email_expires_at timestamptz,
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
    -- owner 自己的 AI provider 搬去了 owner_providers（一份 → 一本，见那张表）。
    -- byoai_* 那条"访客自带 key"的路跟它完全独立，留在这儿。
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
    -- last_vault_import_* —— 上一次 vault 导入的回执（UX-62）。
    --
    -- 为什么这几列必须存在：vault 导入是**定义这个产品 ground truth 的那个操作**，而在此之前
    -- 「它有没有发生过」这个事实在库里根本没有落点 —— 导入完屏幕上冒一行计数，刷新就没了，
    -- 于是装着 1028 条笔记的实例和一个空实例，在 /admin/obsidian 上长得一模一样。
    -- 隔壁 /admin/sources 每一行至少说得出 `never fetched`。
    -- NULL = 从没导过（跟「导过但零变更」是两回事，所以不拿 0 当哨兵）。
    last_vault_import_at      timestamptz,
    last_vault_import_new     integer       NOT NULL DEFAULT 0,
    last_vault_import_updated integer       NOT NULL DEFAULT 0,
    last_vault_import_skipped integer       NOT NULL DEFAULT 0,
    -- deleted —— 剪掉了几条（F-L-62）。跟另外三个不是一类：那三个可逆，这个不可逆。
    last_vault_import_deleted integer       NOT NULL DEFAULT 0,
    created_at           timestamptz   NOT NULL DEFAULT now()
);

-- owner_providers —— owner 的 provider 本子（"像收货地址簿"）。一份 → 一本，其中一条是默认。
--
-- code / role 可以各自指一条（access_codes.provider_id / roles.provider_id）；解析顺序是
-- byoai > code > role > 默认。**code 压过 role** —— 码是发出去的那张票，是更具体的声明。
--
-- key_enc 是封着的：只在 cmd/server/unseal.go 那一处开封（内侧只封不解，§1.5）。
--
-- 两条规则直接长在 schema 里，而不是靠代码记得检查：
--   · ON DELETE SET NULL —— 删掉一条被引用的 provider，引用置空、行还在，读时退默认。
--     "地址删了订单还在，退默认地址"，所以**不用**先解绑所有引用它的 code/role。
--   · 部分唯一索引 —— "两个默认"不可能存在，而不是"会被检查出来"。
--     （删默认那条要拦：没有可退的了。那条在服务层，schema 表达不了"至少一条"。）
CREATE TABLE owner_providers (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    -- label —— owner 自己给这条起的名（"工作那把 key"）。同一 owner 内唯一。
    label       text          NOT NULL,
    -- provider —— preset 名（presets.go 是真源，所以这里没有 CHECK 白名单：
    -- DB CHECK 跟代码漂移比没有更糟）。
    provider    text          NOT NULL,
    key_enc     bytea         NOT NULL DEFAULT ''::bytea,
    -- endpoint —— 仅 provider='custom' 必填；其它留空走 preset 默认 BaseURL。
    endpoint    text          NOT NULL DEFAULT '',
    -- model —— 留空走 preset 默认；owner 想换模型时填。
    model       text          NOT NULL DEFAULT '',
    is_default  boolean       NOT NULL DEFAULT false,
    -- gas_tokens —— 这箱**加了多少**油。NULL = 不计量（#7 的默认路径，绝大多数 owner
    -- 停在这儿）。挂了表的 role 才会去看它。剩多少不存：跟 turn 配额一样读时派生
    -- （gas_tokens − 自 gas_filled_at 起记在这条 provider 上的计量用量）。
    gas_tokens  bigint,
    -- gas_filled_at —— 上次加油的时刻，也就是"从这儿开始算账"。没有它，加满一箱油会被
    -- 之前花掉的量当场吃掉——没有计数器列可以清零，那个零点必须自己记一处。
    gas_filled_at timestamptz,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (owner_id, label)
);
CREATE INDEX owner_providers_owner_idx ON owner_providers(owner_id);
CREATE UNIQUE INDEX owner_providers_one_default ON owner_providers(owner_id) WHERE is_default;

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
    -- aliases —— Obsidian frontmatter 的 `aliases:`(扁平并集;多语言笔记里它是各
    -- `aliases-<lang>` 的并集)。**这条笔记的别名池**,`[[别名]]` 靠它解析到本条。
    -- 跟 title 一起进 ListAllOwnerNoteTitles 的候选表,消歧仍走同一套 pickByProximity ——
    -- 别名不带第二套排序规则。
    -- 在此之前它被解析出来就丢了(frontmatter.go 读进结构体,全仓没人用),于是 owner 在
    -- vault 里靠 Obsidian 别名写的链接,同步进来就断成一段字面量。
    aliases          text[]        NOT NULL DEFAULT '{}',
    source_ids       uuid[]        NOT NULL DEFAULT '{}',
    show_as_source   bool          NOT NULL DEFAULT true,
    excerpt          text          NOT NULL DEFAULT '',
    published        bool          NOT NULL DEFAULT false,
    -- css_classes —— Obsidian `cssclasses` frontmatter:渲染时加到 note 容器的 CSS class(per-note
    -- 呈现钩子,配合 owner CSS snippet)。sync/admin/MCP 三面可写。
    css_classes      text[]        NOT NULL DEFAULT '{}',
    -- lang —— Obsidian frontmatter 的 `lang:`:这条笔记的**身份语言**,也是退不下去时的落点
    -- (`?lang=de` 落在一条没有德语的笔记上 → 按它渲染)。空 = 没写,那时落点是第一个语言面。
    -- 语言集本身不存:它由正文里的 `> [!lang]` 面推出来,每一面自己声明自己的码。存一份会
    -- 立刻跟正文漂移,而漂移了信谁是个不该存在的问题。
    lang             text          NOT NULL DEFAULT '',
    -- lang_labels —— frontmatter 的 `lang-labels:`:语言码 → 切换器上显示的字。
    -- 没写就按码生成(zh→中文 / fr→FR)。
    lang_labels      jsonb         NOT NULL DEFAULT '{}'::jsonb,
    -- Obsidian vault sync 元数据(镜像 writings)。source_path = 来自的 vault 内相对路径
    -- (wiki/x.md);imported_at = 那次 sync 的时刻。reconcile 靠 source_path 认同一条,
    -- web-wins 靠 updated_at > imported_at 判断(owner 在 web 改过 → sync 不覆盖)。
    obsidian_source_path  text      NOT NULL DEFAULT '',
    obsidian_imported_at  timestamptz NULL,
    -- obsidian_frontmatter —— 这条笔记在 vault 里那一块 frontmatter 的**原文**（不含 `---` 围栏）。
    --
    -- 为什么要存原文而不是解析后的字段：产品只认识十来个 key，而真 vault 上还写着 `langs`
    -- （596 篇）、`aliases-zh`（595 篇）、`owns`（33 篇）这些它不认识的。以前的做法是解析时
    -- 「未知 key 直接忽略」—— 忽略在导入侧是对的，但导出侧因此**无从写回**，于是同步一次
    -- 就把它们从 owner 的库里删了（F-L-67）。
    --
    -- 存原文还顺带保住了**形态**：`tags: [a, b]` 是内联数组，重新渲染会变成缩进 list；
    -- 键的顺序也会被重排。内容一样而字节不一样，在一个 git 管着的 vault 里就是一场
    -- 每次同步都发生的假 diff。
    --
    -- 导出时它不是原样回吐：产品拥有的那几个 key 如果在网页上被改过，就地补丁掉那几行，
    -- 其余原样带回。没有这一块的笔记（网页/MCP 新建的）照旧按字段渲染。
    obsidian_frontmatter  text      NOT NULL DEFAULT '',
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
    -- cover_hue —— '' means the owner never picked one. The default used to be 'amber', so
    -- "never picked" had no representation at all: every note in the corpus reported a hue the
    -- owner had not chosen, and the panel's "— default —" option could not be stored (F-L-38).
    -- Writings still land on amber, but explicitly — their create path normalises the value.
    cover_hue        text          NOT NULL DEFAULT '',
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

-- media_assets 已删除：三个 genre 外键、零个写者。它是"每个 genre 都能挂素材"这件事的
-- 一份**没接线的意图**——表建了、FK 指好了，但没有任何代码往里写。真正在用的是 assets
-- （holder_id 无 FK、无 genre 列），素材依附文章、可见性继承文章。

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
    -- provider_id —— 这张码用哪个 provider。NULL = 继承(role,再默认)。**码压过 role**。
    -- SET NULL:那条 provider 被删 → 这张码退回默认,码本身照常用(见 owner_providers)。
    provider_id               uuid          REFERENCES owner_providers(id) ON DELETE SET NULL,
    -- microsite_id —— 这张码开哪一页。NULL = 开默认的访客对话（今天的行为）。
    -- 页面是这张码的一个**渲染**：授权、配额、身份、记账全不变，只换读者看到的样子。
    -- **一张码至多一页**，所以它是码上的一列而不是一张关系表：绑定是一个事实，
    -- 两个面板都读它，谁也不存第二份。SET NULL —— 页删了码退回默认落地，而不是跟着消失。
    -- 外键在 microsites 建完之后补（这张表在它前面，内联写就是前向引用，新卷上直接失败）。
    microsite_id            uuid,
    -- limit_per_period —— 可再生的速率闸：{amount, unit:'turns'|'gas', period_seconds}。
    -- NULL = 不限。max_turns_per_session 是**每场**（访客开新会话就重置）、gas 是**总量**
    -- （花完手动续）；这一个是**每周期自动回满**的桶，按码共享（跟哪个访客/会话无关）。
    -- 留在码上：公开 embed 码要它，但它是码级速率闸，任何用法都适用（embed 规划 2026-09-01）。
    limit_per_period          jsonb,
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
    -- dock_buttons —— #109/#110 这个 role 的 ≤2 个 chat dock 按钮：[{capability_id, trigger}]。
    -- 访客点按钮 = 发触发词（快捷方式）。冻进 RoleSnapshot；title 解析 + code-deny 过滤在会话装配层。
    dock_buttons jsonb         NOT NULL DEFAULT '[]'::jsonb,
    -- require_ghost_evidence —— F-A-10: 开则「内容型引导 ghost」只提有 evidence_refs 的 waypoint;
    -- 空证据的**非终点** waypoint 不当 steering ghost 提出(prompt 规则6从"写着不强制"变成真强制)。
    -- **终点/工具 waypoint(预约)不受影响,永远可提**(它们本就没语料证据)。per-role,code 可覆盖。
    require_ghost_evidence boolean NOT NULL DEFAULT false,
    -- provider_id —— 这个 role 用哪个 provider。NULL = owner 默认。挂在码上的那个压过它。
    provider_id  uuid          REFERENCES owner_providers(id) ON DELETE SET NULL,
    -- gas_metered —— 这个 role 挂不挂油表。false(默认)= 一次 gas 查询都不发,跟今天完全同一条路;
    -- true = 每轮先看它指向的那箱油(#7)。
    gas_metered  boolean       NOT NULL DEFAULT false,
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
    -- kind —— 'image'（正文配图 / hero）| 'attachment'（可下载的附件，如 PDF）。
    -- 收什么类型、多大，按 kind 分：一段视频天生比一张图大，拿同一个数卡它等于禁掉视频。
    -- 默认 image —— 这一列是后加的，既有行都是配图。
    kind               text          NOT NULL DEFAULT 'image',
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
    -- grounded_subjectivity_ids：本轮读到、但**没有** opt-in 的 subjectivity 笔记 —— 塑造了
    -- 声音却不进访客 footer 的那些。以前这些 id 在 show_as_source gate 上被直接丢掉
    -- （dialog.go 的 continue），于是 owner 无从知道自己写的 standpoint 笔记有没有起过作用
    -- （F-A-27）。跟 cited_ 分成两列而不是加一个标志位：访客那条路只读 cited_，多一列就
    -- **结构上**不可能漏进 footer，而不是靠每个读者记得过滤。
    --
    -- 只存 id。展示时 admin transcript 只 hydrate 标题和路径，不取正文 —— owner 要判断的是
    -- 「哪几条在起作用」，不需要把私有正文复制进会话表。
    grounded_subjectivity_ids uuid[] NOT NULL DEFAULT '{}',
    created_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX messages_dialog_idx ON messages(dialog_id);

-- microsites —— owner 自定义 React 页面。
CREATE TABLE microsites (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id               uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    slug                   citext        NOT NULL,
    title                  text          NOT NULL DEFAULT '',
    status                 text          NOT NULL DEFAULT 'active',
    live_build_id          uuid,
    staging_build_id       uuid,
    previous_live_build_id uuid,
    -- allow_byoai —— 没有人出示 grant 时，这一页给不给读者用自己的 key。
    -- **来了 code 就作废**：出示的 grant 决定一切，页面自己的设置只在无人出示时生效（I-4）。
    allow_byoai            boolean       NOT NULL DEFAULT false,
    -- store_writable — whether visitors may WRITE this page's microsite_store namespace. Default false:
    -- a page has zero write attack surface until the owner explicitly opens it (security model C).
    -- Reads are not gated by this; writes are (+ per-page quota, doc-size cap, per-IP rate limit).
    store_writable         boolean       NOT NULL DEFAULT false,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX microsites_owner_slug_idx ON microsites(owner_id, slug);

-- access_codes.microsite_id 的外键：这张表在 access_codes 之后建，所以约束补在这里。
ALTER TABLE access_codes
    ADD CONSTRAINT access_codes_microsite_id_fkey
    FOREIGN KEY (microsite_id) REFERENCES microsites(id) ON DELETE SET NULL;
CREATE INDEX access_codes_microsite_idx ON access_codes(microsite_id);

-- embeds —— owner 的 embed widget 配置。一个 embed = "把某张码作为 <standmeet-chat> 暴露,
-- 只在这些来源站上生效"。**embed 指向 code**（embed 是包着码的配置,它引用它暴露的那张码）,
-- 不是码指向 embed。来源白名单住在这儿而不是码上：码是凭据,"widget 在哪渲染"是 embed 的属性
-- （embed 规划 2026-09-01）。删码 → embed 跟着走（CASCADE）：没有码的 embed 无意义。
CREATE TABLE embeds (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    -- code_id —— 这个 embed 暴露哪张码。widget 用这张码建会话,embed 在它外面加来源限制。
    code_id          uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    label            text          NOT NULL DEFAULT '',
    -- allowed_origins —— 允许这个 embed 在哪些来源站上建会话。空 = 不限。非空 = 只有 Origin
    -- 在表里的请求能用这个 embed 暴露的码。embed 是公开 HTML,钉住来源才能让泄露的码不能到处用。
    allowed_origins  jsonb         NOT NULL DEFAULT '[]'::jsonb,
    -- key_id / public_key —— 每-embed 的 Ed25519 凭据。widget 用私钥签 JWT，服务端按 key_id
    -- 反查公钥验签，再反查出 code_id 发会话。**code 明文不进客户端**，只这把可撤销的密钥进。
    -- nullable：没有 key 的 embed 退回明文 code 那条老路（向后兼容）。
    key_id           uuid,
    public_key       text,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX embeds_owner_idx ON embeds(owner_id);
-- key_id 唯一（NULL 各不相同，多个无 key 的 embed 可共存）：JWT 的 kid 反查必须命中唯一一行。
CREATE UNIQUE INDEX embeds_key_id_uniq ON embeds(key_id);
-- code_id 唯一：一张码最多被一个 embed 暴露，来源白名单才有唯一确定的那一份
-- （两个 embed 挂同一张码时，GetEmbedForCode:one 取哪份白名单是未定义的）。
CREATE UNIQUE INDEX embeds_code_uniq ON embeds(code_id);

CREATE TABLE microsite_builds (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         uuid          NOT NULL REFERENCES microsites(id) ON DELETE CASCADE,
    status          text          NOT NULL DEFAULT 'pending',
    source_files    jsonb         NOT NULL DEFAULT '{}'::jsonb,
    output_path     text          NOT NULL DEFAULT '',
    error_message   text          NOT NULL DEFAULT '',
    created_at      timestamptz   NOT NULL DEFAULT now(),
    built_at        timestamptz
);

-- A custom page's own persistence namespace is NOT a table here. Each page gets its OWN Postgres
-- schema (page_<id>) with a generic records(collection, doc jsonb) table — the capstore pattern
-- (internal/capabilities/capstore, KindMicrosite), same isolation as a plugin: physical schema
-- separation (not a shared table keyed by id), created on page create, DROP SCHEMA CASCADE on page
-- delete. See internal/owner/usecase/microsite_store.go. The only microsite_store trace in core is the
-- microsites.store_writable flag above (whether visitors may write it — security model C).

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
                                    'jba','workday','bamboohr',
                                    'jobicy','remotive','himalayas',
                                    'working_nomads','recruitee',
                                    'jobposting_jsonld','rss')),
    -- config 形状跟 kind 走: greenhouse / lever / ashby / smartrecruiters /
    -- workable 需 {"company": "..."}; wwr 需 {"categories": ["..."]};
    -- remoteok / hn_hiring 不需要 (空 object)。
    config          jsonb         NOT NULL DEFAULT '{}'::jsonb,
    label           text          NOT NULL,
    last_fetched_at timestamptz,
    -- last_attempted_at / last_error —— **「取过但每次都失败」跟「从没取过」必须分得开**。
    -- 只有 last_fetched_at 的时候，一个每次 400 的源和一个从没被碰过的源在
    -- /admin/sources 上是同一行字 `never fetched`，而这一页存在的理由就是回答
    -- 「我这个源还活着吗」（F-E-18）。成败都写这两列；成功时 last_error 是空串，
    -- 不是 NULL —— 这一列永远有值，读的人不必分辨「没写」和「没错」。
    last_attempted_at timestamptz,
    last_error      text          NOT NULL DEFAULT '',
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
    -- template —— 这份草稿选的 Typst 排版（'' = 默认 classic）。定制化的选择项。
    template         text          NOT NULL DEFAULT '',
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
-- 唯一：一张 access code 最多绑一个 application。访客侧简历工具按码反查(:one)"这一份"，
-- 两份绑同一张码则取到哪份未定义 → 招聘官会话可能读到另一份的简历。隔离靠这个不变量。
CREATE UNIQUE INDEX applications_access_code_uniq ON applications(access_code_id);

-- owner_calendar_connectors RETIRED (#155/#190) — the pre-#155 gcal-specific OAuth table was
-- superseded by the generic owner_connectors table below; its repo (CalendarRepo) is deleted.
-- Kept out of fresh installs; existing volumes keep the empty table (harmless).

-- owner_mail_connectors RETIRED (#190) —— 它是 #155 之前 mail 专属的凭据表,已被下面通用的
-- owner_connectors 取代。它的 repo (MailRepo) 和那套邮箱 OTP 验证在本轮删除:
-- **发信早就走通用连接器**(组装根把内核的中性 OutboundSender 接到注册器的
-- Invoke("mail","send",json) 上),这张表和它的 OTP 列**零读写方**,是死存储。
-- 不进新装;既有 volume 里留着空表(无害)。

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
    -- title —— the vendor's own name for this API (info.title), taken once at assemble time.
    -- Uploaded connectors that bind no category contract have an empty `category`, so the list
    -- had nothing to render and two of them read identically (F-C-56). Derived, not owner-typed:
    -- the product already parsed and displayed this string during ingest. Built-ins leave it empty
    -- (their name is the category).
    title            text          NOT NULL DEFAULT '',
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
    -- cached_tokens —— prompt 里命中缓存的那部分(上游单独报的唯一一项细分)。
    -- 上游给不出更细的了:eino 的 claude adapter 在到我们之前就把
    -- input + cache_read + cache_creation 加成了一个数(claude.go:1046),
    -- cache_creation 拿不回来。存我们真拿得到的,不假装有全分辨率。
    cached_tokens  integer       NOT NULL DEFAULT 0,
    -- provider_id —— 这一趟花的是哪箱油。NULL = 那条 provider 已被删(用量记录仍然是历史事实)。
    provider_id    uuid          REFERENCES owner_providers(id) ON DELETE SET NULL,
    -- metered —— 这一行算不算某箱油的账。**它决定这行会不会被 7 天清理带走**:
    -- 看板只看 7 天,但油量是"从加油那次到现在"的累计,清掉旧行等于油自己长回来。
    metered        boolean       NOT NULL DEFAULT false,
    created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX inference_usage_owner_time_idx
    ON inference_usage(owner_id, created_at DESC);
-- 油量是按 (provider, 自加油以来) 求和的,它跟看板那条 (owner, 时间) 不是一条路。
CREATE INDEX inference_usage_gas_idx
    ON inference_usage(provider_id, created_at) WHERE metered;

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
