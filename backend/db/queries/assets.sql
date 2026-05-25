-- name: CreateAsset :one
INSERT INTO assets (id, owner_id, storage_key, content_type, size_bytes, sha256, original_filename)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, owner_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at;

-- name: GetAssetByID :one
SELECT id, owner_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at
FROM assets
WHERE id = $1;

-- name: GetAssetByIDForOwner :one
SELECT id, owner_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at
FROM assets
WHERE id = $1 AND owner_id = $2;

-- name: ListAssetsByOwner :many
-- $2 = 0 → 无 limit (NULLIF 把 0 转 NULL，LIMIT NULL = 全返)。orphan 扫
-- 必须能拉到所有 owner asset 否则会漏。admin /assets list usecase 默认
-- 传 50；orphan scan 传 0。
SELECT id, owner_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at
FROM assets
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT NULLIF($2::int, 0);

-- name: DeleteAsset :exec
DELETE FROM assets
WHERE id = $1 AND owner_id = $2;
