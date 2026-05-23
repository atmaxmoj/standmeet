-- name: GetSEOSettings :one
SELECT owner_id, index_robots, sitemap_extras, og_template, updated_at
FROM seo_settings
WHERE owner_id = $1;

-- name: UpsertSEOSettings :one
INSERT INTO seo_settings (owner_id, index_robots, sitemap_extras, og_template, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (owner_id) DO UPDATE SET
    index_robots   = EXCLUDED.index_robots,
    sitemap_extras = EXCLUDED.sitemap_extras,
    og_template    = EXCLUDED.og_template,
    updated_at     = now()
RETURNING owner_id, index_robots, sitemap_extras, og_template, updated_at;

-- name: GetWikiByPath :one
-- 用 owner_id + path 反查 wiki entry（公开 landing /<handle>/wiki/<path>）。
-- 公开 landing 只暴露 seo_indexed=true 的 entry（crawler 友好可见）；
-- 准入靠 retrieval ACL，跟公开 landing 是两个面。
SELECT *
FROM wiki_entries
WHERE owner_id = $1 AND path = $2 AND seo_indexed = true;

-- name: ListIndexedWikiPaths :many
-- sitemap.xml 用：取该 owner 所有 indexed wiki landing path。
SELECT path, updated_at
FROM wiki_entries
WHERE owner_id = $1
  AND path IS NOT NULL
  AND seo_indexed = true
ORDER BY updated_at DESC;

-- name: UpdateWikiPath :one
-- admin / MCP 编辑 path + SEO 描述 + indexed 开关。
UPDATE wiki_entries
SET path            = $2,
    seo_description = $3,
    seo_indexed     = $4,
    updated_at      = now()
WHERE id = $1
RETURNING *;
