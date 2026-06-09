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

-- 公开 landing 反查 + sitemap path 列表移到 usecases/seo.go：地址纯树派生
-- (load 全树 → WikiTreePaths/OutputTreePaths),不读 path 列。wiki/output 的
-- SEO patch 走 UpdateWikiSEO / UpdateOutputSEO（corpus.sql / output.sql）。
