-- +goose Up

-- raw_entries —— owner 用任意 AI 通过 MCP push 进来的"半成品"。
-- promoted_to_wiki=NULL 时是未提升的 raw；提升后变 wiki_entries 一条。
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

CREATE INDEX raw_entries_owner_created_idx
    ON raw_entries(owner_id, created_at DESC)
    WHERE archived = false;

-- wiki_entries —— curated 内容，树状组织。parent_id 形成森林（owner 多个根）；
-- path 是 induced（从 parent 链 walk 出来），不冗余存。
-- 不开 SEO landing / embedding 字段；后续按需 ALTER TABLE 加上。
CREATE TABLE wiki_entries (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    parent_id       uuid          REFERENCES wiki_entries(id) ON DELETE SET NULL,
    title           text          NOT NULL,
    body            text          NOT NULL,
    tags            text[]        NOT NULL DEFAULT '{}',
    visibility      text          NOT NULL DEFAULT 'public'
                                  CHECK (visibility IN ('public', 'on_request', 'private')),
    source_raw_ids  uuid[]        NOT NULL DEFAULT '{}',
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX wiki_entries_owner_vis_idx ON wiki_entries(owner_id, visibility);
CREATE INDEX wiki_entries_parent_idx ON wiki_entries(parent_id) WHERE parent_id IS NOT NULL;

-- promoted_to 形成对 wiki_entries.id 的弱引用（不加 FK 避免循环 cascade
-- 问题；application 层负责 promote 后写入这个字段）。
ALTER TABLE raw_entries
    ADD CONSTRAINT raw_entries_promoted_fk
    FOREIGN KEY (promoted_to) REFERENCES wiki_entries(id) ON DELETE SET NULL;

-- media_assets —— 图 / 音频 / 文件附件。raw_entry_id / wiki_entry_id 至少一非空。
CREATE TABLE media_assets (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    kind            text          NOT NULL CHECK (kind IN ('image', 'audio', 'file')),
    filename        text          NOT NULL,
    mime_type       text          NOT NULL,
    size_bytes      bigint        NOT NULL DEFAULT 0,
    storage_key     text          NOT NULL,
    raw_entry_id    uuid          REFERENCES raw_entries(id) ON DELETE SET NULL,
    wiki_entry_id   uuid          REFERENCES wiki_entries(id) ON DELETE SET NULL,
    created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX media_assets_owner_idx ON media_assets(owner_id);

-- +goose Down
DROP TABLE media_assets;
ALTER TABLE raw_entries DROP CONSTRAINT raw_entries_promoted_fk;
DROP TABLE wiki_entries;
DROP TABLE raw_entries;
