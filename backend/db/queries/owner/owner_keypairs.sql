-- name: CreateOwnerKeypair :one
INSERT INTO owner_keypairs (owner_id, key_id, public_key_pem, label)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListOwnerKeypairs :many
SELECT id, key_id, label, last_used_at, last_used_ip, last_used_user_agent, created_at
FROM owner_keypairs
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: GetOwnerKeypairByKeyID :one
SELECT * FROM owner_keypairs WHERE key_id = $1;

-- name: TouchOwnerKeypair :exec
UPDATE owner_keypairs
SET last_used_at = now(), last_used_ip = $2, last_used_user_agent = $3
WHERE id = $1;

-- name: DeleteOwnerKeypair :exec
DELETE FROM owner_keypairs WHERE key_id = $1 AND owner_id = $2;
