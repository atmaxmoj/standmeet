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
SELECT id, owner_id, storage_key, content_type, size_bytes, sha256, original_filename, created_at
FROM assets
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: DeleteAsset :exec
DELETE FROM assets
WHERE id = $1 AND owner_id = $2;
