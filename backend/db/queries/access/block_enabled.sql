-- name: UpsertBlockEnabled :exec
-- The owner explicitly turns a block on/off. Upsert on (owner_id, block_id), safe under
-- concurrent toggles (PRIMARY KEY conflict goes to DO UPDATE, no half-row left).
INSERT INTO block_enabled (owner_id, block_id, enabled)
VALUES ($1, $2, $3)
ON CONFLICT (owner_id, block_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = now();

-- name: ListBlockEnabled :many
-- Every explicit preference row for this owner (a block with no row is on).
SELECT block_id, enabled
FROM block_enabled
WHERE owner_id = $1;
