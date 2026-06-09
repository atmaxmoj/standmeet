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

-- name: UpdateOutputBody :one
-- admin "edit output" 入口；跟 UpdateWikiBody 同构。
UPDATE output_entries
SET title = $3, body = $4, tags = $5, parent_id = $6, show_as_source = $7,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: UpdateOutputSEO :one
-- admin / MCP 编辑 SEO 描述 + indexed 开关（地址树派生,无 path 列）。
UPDATE output_entries
SET seo_description = $2, seo_indexed = $3, updated_at = now()
WHERE id = $1
RETURNING *;
