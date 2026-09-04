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
-- SEO panel indexing stats: the owner's published-entry counts per tier (wiki/output) +
-- published writing count. The owner picks the stat scope in the UI; the default includes all (sum of the three).
SELECT
    (SELECT count(*) FROM corpus_notes w  WHERE w.owner_id = $1 AND w.genre = 'wiki'   AND w.published)  AS wiki,
    (SELECT count(*) FROM corpus_notes o  WHERE o.owner_id = $1 AND o.genre = 'output' AND o.published)  AS outputs,
    (SELECT count(*) FROM corpus_notes wr WHERE wr.owner_id = $1 AND wr.genre = 'writing' AND wr.published_at IS NOT NULL) AS writings;

-- Public landing lookup + sitemap path list moved to usecases/seo.go: addresses are purely
-- tree-derived (load the whole tree → WikiTreePaths/OutputTreePaths), not read from a path column.
-- The wiki/output excerpt/published patch goes through UpdateWikiSEO / UpdateOutputSEO (corpus.sql / output.sql).
