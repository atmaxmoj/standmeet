-- +goose Up

-- output_entries —— raw → wiki → output 三层中的最精炼层。
--
-- 跟 wiki_entries 同构（也是 owner-scoped 树状，带 SEO 字段），区别只在
-- 语义：output 是 "完整到可以在对话里被原样引用" 的精炼版（wiki 是组织
-- 过但可能片段化）。owner 通过 MCP `promote_wiki_to_output` 从 wiki 提
-- 炼上来；source_wiki_ids 记录出处。
--
-- 一并加 media_assets.output_entry_id FK，让上传到 output 的图同时挂这一层。
CREATE TABLE IF NOT EXISTS output_entries (
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

CREATE UNIQUE INDEX IF NOT EXISTS output_entries_owner_slug_idx
    ON output_entries(owner_id, seo_slug)
    WHERE seo_slug IS NOT NULL;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS output_entry_id uuid
    REFERENCES output_entries(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE media_assets DROP COLUMN IF EXISTS output_entry_id;
DROP INDEX IF EXISTS output_entries_owner_slug_idx;
DROP TABLE IF EXISTS output_entries;
