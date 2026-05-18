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

-- name: GetWikiBySlug :one
-- 用 owner_id + seo_slug 反查 wiki entry（public-facing wiki landing）。
SELECT id, owner_id, parent_id, title, body, tags, visibility,
       source_raw_ids, seo_slug, seo_description, seo_indexed,
       created_at, updated_at
FROM wiki_entries
WHERE owner_id = $1 AND seo_slug = $2 AND visibility = 'public';

-- name: ListIndexedWikiSlugs :many
-- sitemap.xml 用：取该 owner 所有 indexed + public 的 wiki landing slug。
SELECT seo_slug, updated_at
FROM wiki_entries
WHERE owner_id = $1
  AND seo_slug IS NOT NULL
  AND seo_indexed = true
  AND visibility = 'public'
ORDER BY updated_at DESC;

-- name: UpdateWikiSEO :one
-- admin / MCP 设 wiki 的 seo_slug / seo_description / seo_indexed。
UPDATE wiki_entries
SET seo_slug        = $2,
    seo_description = $3,
    seo_indexed     = $4,
    updated_at      = now()
WHERE id = $1
RETURNING id, owner_id, parent_id, title, body, tags, visibility,
          source_raw_ids, seo_slug, seo_description, seo_indexed,
          created_at, updated_at;
