-- name: GetSEOSettings :one
SELECT owner_id, site_title, index_robots, sitemap_extras, og_template, updated_at
FROM seo_settings
WHERE owner_id = $1;

-- name: UpsertSEOSettings :one
INSERT INTO seo_settings (owner_id, site_title, index_robots, sitemap_extras, og_template, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (owner_id) DO UPDATE SET
    site_title     = EXCLUDED.site_title,
    index_robots   = EXCLUDED.index_robots,
    sitemap_extras = EXCLUDED.sitemap_extras,
    og_template    = EXCLUDED.og_template,
    updated_at     = now()
RETURNING owner_id, site_title, index_robots, sitemap_extras, og_template, updated_at;

-- name: CountPublishedCorpus :one
-- SEO 面 indexing stats：owner 各 tier 已 published 的条目数（wiki/output）+
-- published writing 数。owner 在 UI 选统计范围，默认全含（三者相加）。
SELECT
    (SELECT count(*) FROM corpus_notes w  WHERE w.owner_id = $1 AND w.genre = 'wiki'   AND w.published)  AS wiki,
    (SELECT count(*) FROM corpus_notes o  WHERE o.owner_id = $1 AND o.genre = 'output' AND o.published)  AS outputs,
    (SELECT count(*) FROM writings     wr WHERE wr.owner_id = $1 AND wr.published_at IS NOT NULL) AS writings;

-- 公开 landing 反查 + sitemap path 列表移到 usecases/seo.go：地址纯树派生
-- (load 全树 → WikiTreePaths/OutputTreePaths),不读 path 列。wiki/output 的
-- excerpt/published patch 走 UpdateWikiSEO / UpdateOutputSEO（corpus.sql / output.sql）。
