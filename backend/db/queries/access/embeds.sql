-- name: CreateEmbed :one
INSERT INTO embeds (owner_id, code_id, label, allowed_origins, key_id, public_key)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetEmbedAuthByKeyID :one
-- Used at session issuance to look up by the JWT's kid: this embed's public key (verify signature)
-- + allow list (check origin) + the code it exposes (issue the session). The plaintext code is
-- obtained only at this step, server-side.
SELECT e.public_key, e.allowed_origins, ac.code
FROM embeds e
JOIN access_codes ac ON e.code_id = ac.id
WHERE e.key_id = $1;

-- name: GetEmbed :one
SELECT * FROM embeds WHERE id = $1 AND owner_id = $2;

-- name: ListEmbedsByOwner :many
SELECT * FROM embeds WHERE owner_id = $1 ORDER BY created_at DESC;

-- name: UpdateEmbed :one
UPDATE embeds
SET label = $3, allowed_origins = $4, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: DeleteEmbed :exec
DELETE FROM embeds WHERE id = $1 AND owner_id = $2;

