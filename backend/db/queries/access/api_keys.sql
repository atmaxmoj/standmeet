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

-- name: ListAPIKeysPage :many
-- One page of the owner's keys, newest first, revoked ones included (docs/design/paging.md).
SELECT sqlc.embed(k),
  (SELECT COUNT(*) FROM api_keys k2 WHERE k2.owner_id = sqlc.arg('owner_id'))::int AS total
FROM api_keys k
WHERE k.owner_id = sqlc.arg('owner_id')
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (k.created_at, k.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY k.created_at DESC, k.id DESC
LIMIT sqlc.arg('lim');

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

-- name: AddAPIKeyBlockDenial :exec
INSERT INTO api_key_block_denials (key_id, block_id)
VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteAPIKeyBlockDenial :exec
DELETE FROM api_key_block_denials WHERE key_id = $1 AND block_id = $2;

-- name: ListAPIKeyBlockDenials :many
SELECT block_id FROM api_key_block_denials WHERE key_id = $1;

-- name: AddAPIKeySkillDenial :exec
INSERT INTO api_key_skill_denials (key_id, skill_id)
VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteAPIKeySkillDenial :exec
DELETE FROM api_key_skill_denials WHERE key_id = $1 AND skill_id = $2;

-- name: ListAPIKeySkillDenials :many
SELECT skill_id FROM api_key_skill_denials WHERE key_id = $1;

-- ───── candidacy ("open") gate ─────

-- name: OpenAPIBlock :exec
INSERT INTO api_open_blocks (owner_id, block_id)
VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: CloseAPIBlock :exec
DELETE FROM api_open_blocks WHERE owner_id = $1 AND block_id = $2;

-- name: ListAPIOpenBlocks :many
SELECT block_id FROM api_open_blocks
WHERE owner_id = $1 ORDER BY block_id;
