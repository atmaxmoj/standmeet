-- api_keys.sql —— API-key facade persistence (facade-directions.md). Keys are
-- role-scoped programmatic credentials; parallel to access_codes.

-- name: CreateAPIKey :one
INSERT INTO api_keys (
    owner_id, assumed_role_id, label, prefix, secret_hash,
    rate_limit_rpm, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetAPIKeyBySecretHash :one
-- Auth lookup: only an ACTIVE, unexpired key resolves. A revoked/expired/unknown
-- secret returns no row → the middleware answers 401.
SELECT * FROM api_keys
WHERE secret_hash = $1
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > now());

-- name: ListAPIKeysByOwner :many
SELECT * FROM api_keys
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: GetAPIKeyByID :one
SELECT * FROM api_keys
WHERE id = $1 AND owner_id = $2;

-- name: RevokeAPIKey :execrows
-- **:execrows, not :exec** —— an id that isn't there (stale list, another tab, another owner's key)
-- matches zero rows and postgres reports no error. Telling an owner "revoked" about a key that
-- still works is the worst lie this table can produce, so the caller has to see the row count.
-- Same reason CodeRepo.Revoke has checked its CommandTag for a long time.
UPDATE api_keys
SET status = 'revoked'
WHERE id = $1 AND owner_id = $2;

-- name: UpdateAPIKey :one
-- Partial update: COALESCE keeps the existing value when the arg is NULL.
UPDATE api_keys
SET label          = COALESCE(sqlc.narg('label'), label),
    rate_limit_rpm = CASE WHEN sqlc.arg('set_rate')::bool
                          THEN sqlc.narg('rate_limit_rpm') ELSE rate_limit_rpm END
WHERE id = sqlc.arg('id') AND owner_id = sqlc.arg('owner_id')
RETURNING *;

-- name: TouchAPIKeyLastUsed :exec
UPDATE api_keys SET last_used_at = now() WHERE id = $1;

-- ───── per-key denials (mirror code denials) ─────

-- name: AddAPIKeyCapabilityDenial :exec
INSERT INTO api_key_capability_denials (key_id, capability_id)
VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteAPIKeyCapabilityDenial :exec
DELETE FROM api_key_capability_denials WHERE key_id = $1 AND capability_id = $2;

-- name: ListAPIKeyCapabilityDenials :many
SELECT capability_id FROM api_key_capability_denials WHERE key_id = $1;

-- name: AddAPIKeySkillDenial :exec
INSERT INTO api_key_skill_denials (key_id, skill_id)
VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteAPIKeySkillDenial :exec
DELETE FROM api_key_skill_denials WHERE key_id = $1 AND skill_id = $2;

-- name: ListAPIKeySkillDenials :many
SELECT skill_id FROM api_key_skill_denials WHERE key_id = $1;

-- ───── candidacy ("open") gate ─────

-- name: OpenAPICapability :exec
INSERT INTO api_open_capabilities (owner_id, capability_id)
VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: CloseAPICapability :exec
DELETE FROM api_open_capabilities WHERE owner_id = $1 AND capability_id = $2;

-- name: ListAPIOpenCapabilities :many
SELECT capability_id FROM api_open_capabilities
WHERE owner_id = $1 ORDER BY capability_id;
