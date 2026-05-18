-- +goose Up

-- wiki_entries 加 SEO 三件套：slug（owner 域内唯一）、description、indexed flag。
-- 没填的 slug 不生成 landing；indexed=false 也不进 sitemap。
ALTER TABLE wiki_entries
    ADD COLUMN seo_slug         citext,
    ADD COLUMN seo_description  text  NOT NULL DEFAULT '',
    ADD COLUMN seo_indexed      bool  NOT NULL DEFAULT false;

-- 同 owner 内 slug 唯一（NULL 不冲突，PostgreSQL UNIQUE 默认放过）。
CREATE UNIQUE INDEX wiki_entries_owner_slug_idx
    ON wiki_entries(owner_id, seo_slug)
    WHERE seo_slug IS NOT NULL;

-- seo_settings —— owner 维度的 SEO 全局开关：robots 允许爬、sitemap 额外
-- 静态 URL（owner 自己页面之外想往 sitemap 塞的）、og_template 用作
-- og:image 渲染的 prefix 文字。Singleton-per-owner（owner_id PK）。
CREATE TABLE seo_settings (
    owner_id        uuid          PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    index_robots    bool          NOT NULL DEFAULT true,
    sitemap_extras  jsonb         NOT NULL DEFAULT '[]'::jsonb,
    og_template     text          NOT NULL DEFAULT '',
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS seo_settings;
DROP INDEX IF EXISTS wiki_entries_owner_slug_idx;
ALTER TABLE wiki_entries
    DROP COLUMN IF EXISTS seo_indexed,
    DROP COLUMN IF EXISTS seo_description,
    DROP COLUMN IF EXISTS seo_slug;
