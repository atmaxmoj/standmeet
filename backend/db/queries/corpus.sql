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

-- name: CreateWikiEntry :one
INSERT INTO wiki_entries (owner_id, parent_id, title, body, tags, visibility, source_raw_ids)
VALUES ($1, $2, $3, $4, $5, $6, $7)
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

-- Path 是 induced：repo 层调 GetWikiByID 走 parent 链直到 parent_id IS NULL，
-- 把 title 拼成 "/grandparent/parent/me"。v1 不走 recursive CTE（sqlc 解析
-- ambiguity 问题 + N+1 树深通常 ≤ 5 可接受）。
