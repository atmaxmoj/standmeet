-- name: CreateAsset :one
INSERT INTO assets (id, holder_id, storage_key, content_type, size_bytes, sha256, original_filename)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, holder_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at;

-- name: GetAssetByID :one
SELECT id, holder_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at
FROM assets
WHERE id = $1;

-- name: ListAssetsByHolder :many
SELECT id, holder_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at
FROM assets
WHERE holder_id = $1;

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
