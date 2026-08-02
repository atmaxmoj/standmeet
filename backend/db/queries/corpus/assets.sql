-- name: CreateAsset :one
INSERT INTO assets (id, holder_id, storage_key, content_type, size_bytes, sha256, original_filename, kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetAssetByID :one
SELECT * FROM assets
WHERE id = $1;

-- name: ListAssetsByHolder :many
SELECT * FROM assets
WHERE holder_id = $1
ORDER BY created_at;

-- name: DeleteAssetsByHolder :many
-- 删一个 holder 的所有 asset 行；返 storage_key 让 caller 后置批删 MinIO blob。
DELETE FROM assets
WHERE holder_id = $1
RETURNING storage_key;

-- name: DeleteAssetsByIDs :many
-- 按 id 集合删；caller 已经知道这些 id 是同一个 holder 的（update 时算
-- removed = old_refs - new_refs）。返 storage_key 让 caller 删 blob。
DELETE FROM assets
WHERE id = ANY($1::uuid[])
RETURNING storage_key;
