-- name: CreateAPIToken :one
INSERT INTO api_tokens (owner_id, name, token_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListAPITokensByOwner :many
SELECT id, name, last_used_at, created_at FROM api_tokens
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: GetAPITokenByHash :one
SELECT * FROM api_tokens WHERE token_hash = $1;

-- name: TouchAPIToken :exec
UPDATE api_tokens SET last_used_at = now() WHERE id = $1;

-- name: DeleteAPIToken :exec
DELETE FROM api_tokens WHERE id = $1 AND owner_id = $2;
