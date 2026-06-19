-- name: UpsertCapabilitySetting :exec
-- Phase H: owner 显式开/关一个 capability。(owner_id, capability_id) upsert，
-- 并发 toggle 安全（PRIMARY KEY 冲突走 DO UPDATE，不留半行）。
INSERT INTO capability_settings (owner_id, capability_id, enabled)
VALUES ($1, $2, $3)
ON CONFLICT (owner_id, capability_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = now();

-- name: ListCapabilitySettings :many
-- 该 owner 所有显式偏好行（没行的 capability 走默认开）。
SELECT capability_id, enabled
FROM capability_settings
WHERE owner_id = $1;
