-- Global asset pool + references (docs/design/global-assets.md).
-- An asset belongs to an owner; corpus entries / microsites reference it via
-- asset_references. A referenced asset can't be deleted — the referrer goes first.

-- name: CreateAsset :one
INSERT INTO assets (id, owner_id, holder_id, storage_key, content_type, size_bytes, sha256, original_filename, kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetAssetByID :one
SELECT * FROM assets
WHERE id = $1;

-- name: ListAssetsByOwner :many
SELECT * FROM assets
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: DeleteAssetByID :one
-- Pool delete of a single asset the caller has already confirmed is unreferenced
-- (see CountAssetReferences). Scoped to owner. Returns storage_key so the caller
-- drops the MinIO blob afterward.
DELETE FROM assets
WHERE id = $1 AND owner_id = $2
RETURNING storage_key;

-- ── references ────────────────────────────────────────────────────────────────

-- name: InsertAssetReference :exec
INSERT INTO asset_references (asset_id, referrer_kind, referrer_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: DeleteAssetReferencesByReferrer :exec
-- Drop every reference a single referrer holds — on referrer delete, and as the
-- first half of a rewrite. Assets survive in the pool.
DELETE FROM asset_references
WHERE referrer_kind = $1 AND referrer_id = $2;

-- name: ListAssetReferencesByAsset :many
-- Who references this asset — feeds the delete-guard's "used by …" message.
SELECT referrer_kind, referrer_id
FROM asset_references
WHERE asset_id = $1
ORDER BY referrer_kind, referrer_id;

-- name: CountAssetReferences :one
SELECT count(*) FROM asset_references
WHERE asset_id = $1;

-- name: DeleteAssetReference :exec
-- Drop one specific reference (a note stops using one image; assets survive).
DELETE FROM asset_references
WHERE asset_id = $1 AND referrer_kind = $2 AND referrer_id = $3;

-- name: FilterOwnedAssetIDs :many
-- Of the given ids, which are real pool assets this owner owns. The
-- reference-recompute-on-save uses it to keep asset_references honest: a body may
-- cite a deleted id or another owner's id, and neither should get a reference (nor
-- break the save). Only owner-owned, existing ids come back.
SELECT id FROM assets
WHERE owner_id = @owner_id AND id = ANY(@ids::uuid[]);

-- name: ListAssetsByReferrer :many
-- The assets one referrer (a note / microsite) references — the "files on this
-- entry" view, now expressed as references rather than holder ownership.
SELECT a.* FROM assets a
JOIN asset_references r ON r.asset_id = a.id
WHERE r.referrer_kind = $1 AND r.referrer_id = $2
ORDER BY a.created_at;
