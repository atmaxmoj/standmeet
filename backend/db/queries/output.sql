-- output_entries —— wiki 的最精炼版镜像。query 命名跟 wiki 对齐让代码生成
-- 的方法名易认（CreateOutputEntry / ListOutputByOwner / ...）。

-- name: CreateOutputEntry :one
INSERT INTO output_entries (
    owner_id, parent_id, title, body, tags, source_wiki_ids
)
VALUES ($1, $2, $3, $4, $5, $6)
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

-- name: GetOutputTitlesByIDs :many
-- transcript hydration 用：把 cited_output_ids 批量解到 id+title+path。
SELECT id, title, path FROM output_entries
WHERE owner_id = $1 AND id = ANY($2::uuid[]);

-- name: UpdateOutputBody :one
-- admin "edit output" 入口；跟 UpdateWikiBody 同构。
UPDATE output_entries
SET title = $3, body = $4, tags = $5, parent_id = $6, show_as_source = $7,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: GetOutputByPath :one
-- 用 owner_id + path 反查 output entry（公开 landing /<handle>/output/<path>）。
-- 不再 filter visibility ——准入靠 access_codes.corpus_permissions，公开 landing
-- 只能拿 seo_indexed=true 的（crawler/SEO 友好可见）。
SELECT id, owner_id, parent_id, title, body, tags,
       source_wiki_ids, path, show_as_source, seo_description, seo_indexed,
       created_at, updated_at
FROM output_entries
WHERE owner_id = $1 AND path = $2 AND seo_indexed = true;

-- name: ListIndexedOutputPaths :many
-- sitemap.xml 用：取该 owner 所有 indexed output landing path。
SELECT path, updated_at
FROM output_entries
WHERE owner_id = $1
  AND path IS NOT NULL
  AND seo_indexed = true
ORDER BY updated_at DESC;

-- name: UpdateOutputPath :one
-- admin / MCP 编辑 path + SEO 描述 + indexed 开关。
UPDATE output_entries
SET path            = $2,
    seo_description = $3,
    seo_indexed     = $4,
    updated_at      = now()
WHERE id = $1
RETURNING *;
