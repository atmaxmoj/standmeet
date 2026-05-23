-- output_entries —— wiki 的最精炼版镜像。query 命名跟 wiki 对齐让代码生成
-- 的方法名易认（CreateOutputEntry / ListOutputByOwner / ...）。

-- name: CreateOutputEntry :one
INSERT INTO output_entries (
    owner_id, parent_id, title, body, tags, visibility, source_wiki_ids
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListOutputByOwner :many
SELECT * FROM output_entries
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: GetOutputByID :one
SELECT * FROM output_entries WHERE id = $1 AND owner_id = $2;

-- name: DeleteOutput :exec
DELETE FROM output_entries WHERE id = $1 AND owner_id = $2;

-- name: SetOutputTags :exec
UPDATE output_entries SET tags = $3, updated_at = now() WHERE id = $1 AND owner_id = $2;

-- name: GetOutputBySlug :one
-- 用 owner_id + seo_slug 反查 output entry（public-facing output landing 复用 wiki 同套路）。
SELECT id, owner_id, parent_id, title, body, tags, visibility,
       source_wiki_ids, seo_slug, seo_description, seo_indexed,
       created_at, updated_at
FROM output_entries
WHERE owner_id = $1 AND seo_slug = $2 AND visibility = 'public';

-- name: UpdateOutputSEO :one
UPDATE output_entries
SET seo_slug        = $2,
    seo_description = $3,
    seo_indexed     = $4,
    updated_at      = now()
WHERE id = $1
RETURNING id, owner_id, parent_id, title, body, tags, visibility,
          source_wiki_ids, seo_slug, seo_description, seo_indexed,
          created_at, updated_at;
