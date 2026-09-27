-- name: CreateEmbed :one
INSERT INTO embeds (owner_id, code_id, label, allowed_origins, key_id, public_key, sync_mode)
VALUES ($1, $2, $3, $4, $5, $6, $7)
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

-- name: ListEmbedsPage :many
-- One page of the owner's embeds, newest first (docs/design/paging.md), each with the code
-- string it exposes: the paged codes list can no longer answer "which string is code_id X".
SELECT sqlc.embed(e), ac.code AS code_value
FROM embeds e
JOIN access_codes ac ON ac.id = e.code_id
WHERE e.owner_id = sqlc.arg('owner_id')
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (e.created_at, e.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg('lim');

-- name: UpdateEmbed :one
UPDATE embeds
SET label = $3, allowed_origins = $4, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: SetEmbedSyncMode :one
UPDATE embeds
SET sync_mode = $3, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: GetEmbedSyncModeByKeyID :one
-- The public read a consuming site makes (GET /api/v1/embeds/{kid}); the kid is already public.
SELECT sync_mode FROM embeds WHERE key_id = $1;

-- name: DeleteEmbed :exec
DELETE FROM embeds WHERE id = $1 AND owner_id = $2;

