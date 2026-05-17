-- name: CreateAccessCode :one
INSERT INTO access_codes (owner_id, code, label, purpose, included_tags, excluded_tags, suggested_questions, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetAccessCode :one
SELECT * FROM access_codes WHERE code = $1 AND status = 'active';

-- name: ListAccessCodesByOwner :many
SELECT * FROM access_codes WHERE owner_id = $1 ORDER BY created_at DESC;

-- name: RevokeAccessCode :exec
UPDATE access_codes SET status = 'revoked' WHERE id = $1 AND owner_id = $2;

-- name: CreateCodeMember :one
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListCodeMembers :many
SELECT * FROM code_members WHERE code_id = $1;

-- name: TouchCodeMember :exec
UPDATE code_members SET last_seen_at = now() WHERE id = $1;
