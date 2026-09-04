-- name: UpsertCapabilitySetting :exec
-- Phase H: owner explicitly turns a capability on/off. Upsert on (owner_id, capability_id),
-- safe under concurrent toggles (PRIMARY KEY conflict goes to DO UPDATE, no half-row left).
INSERT INTO capability_settings (owner_id, capability_id, enabled)
VALUES ($1, $2, $3)
ON CONFLICT (owner_id, capability_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = now();

-- name: ListCapabilitySettings :many
-- All explicit preference rows for this owner (a capability with no row defaults to on).
SELECT capability_id, enabled
FROM capability_settings
WHERE owner_id = $1;
