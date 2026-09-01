-- name: CreateEmbed :one
INSERT INTO embeds (owner_id, code_id, label, allowed_origins, key_id, public_key)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetEmbedAuthByKeyID :one
-- session 签发时靠它按 JWT 的 kid 反查：这个 embed 的公钥（验签）+ 白名单（校 origin）+
-- 它暴露的码（发会话）。code 明文只在这一步、服务端拿到。
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

