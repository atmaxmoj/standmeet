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
-- Delete all asset rows for one holder; return storage_key so the caller can batch-delete the MinIO blobs afterward.
DELETE FROM assets
WHERE holder_id = $1
RETURNING storage_key;

-- name: DeleteAssetsByIDs :many
-- Delete by a set of ids; the caller already knows these ids belong to the same holder
-- (on update it computes removed = old_refs - new_refs). Return storage_key so the caller can delete the blobs.
DELETE FROM assets
WHERE id = ANY($1::uuid[])
RETURNING storage_key;
