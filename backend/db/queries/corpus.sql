-- name: CreateRawEntry :one
INSERT INTO raw_entries (owner_id, body, source, source_meta, tags, flagged_private)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListRawByOwner :many
SELECT * FROM raw_entries
WHERE owner_id = $1 AND archived = false
ORDER BY created_at DESC
LIMIT $2;

-- name: GetRawByID :one
SELECT * FROM raw_entries WHERE id = $1 AND owner_id = $2;

-- name: ArchiveRaw :exec
UPDATE raw_entries SET archived = true WHERE id = $1 AND owner_id = $2;

-- name: SetRawTags :exec
UPDATE raw_entries SET tags = $3 WHERE id = $1 AND owner_id = $2;

-- name: MarkRawPromoted :exec
UPDATE raw_entries SET promoted_to = $3 WHERE id = $1 AND owner_id = $2;

-- name: UpdateRawBody :one
-- admin "edit raw" 入口：改 body + tags + flagged_private。source 不动
-- （source 是 ingest 来源标签，编辑不该改）。
UPDATE raw_entries
SET body = $3, tags = $4, flagged_private = $5
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: CreateWikiEntry :one
INSERT INTO wiki_entries (owner_id, parent_id, title, body, tags, source_raw_ids)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListWikiByOwner :many
SELECT * FROM wiki_entries
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: GetWikiByID :one
SELECT * FROM wiki_entries WHERE id = $1 AND owner_id = $2;

-- name: DeleteWiki :exec
DELETE FROM wiki_entries WHERE id = $1 AND owner_id = $2;

-- name: SetWikiTags :exec
UPDATE wiki_entries SET tags = $3, updated_at = now() WHERE id = $1 AND owner_id = $2;

-- name: UpdateWikiBody :one
-- admin "edit wiki" 入口：改 title/body/tags/parent_id/show_as_source。
-- seo_description / seo_indexed 由 UpdateWikiSEO 单独负责。地址纯树派生,无 path 列。
UPDATE wiki_entries
SET title = $3, body = $4, tags = $5, parent_id = $6, show_as_source = $7,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: UpdateWikiSEO :one
-- admin / MCP 编辑 SEO 描述 + indexed 开关（地址树派生,owner 不再自设 path）。
UPDATE wiki_entries
SET seo_description = $2, seo_indexed = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- 地址(path)是 induced：纯从 parent 链 + title slug 算（usecases.WikiTreePaths），
-- 不存列、不可由 owner 自设。
