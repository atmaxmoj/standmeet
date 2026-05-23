-- name: CreateAccessCode :one
INSERT INTO access_codes (
    owner_id, code, label, purpose, corpus_permissions, suggested_questions,
    expires_at, max_sessions_per_member, max_turns_per_session
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: UpdateAccessCodePermissions :one
UPDATE access_codes
SET corpus_permissions = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: GetAccessCode :one
SELECT * FROM access_codes WHERE code = $1 AND status = 'active';

-- name: GetAccessCodeByID :one
SELECT * FROM access_codes WHERE id = $1;

-- name: ListAccessCodesByOwner :many
SELECT * FROM access_codes WHERE owner_id = $1 ORDER BY created_at DESC;

-- name: RevokeAccessCode :exec
UPDATE access_codes SET status = 'revoked' WHERE id = $1 AND owner_id = $2;

-- name: UpdateAccessCodeQuotas :one
UPDATE access_codes
SET max_sessions_per_member = $3, max_turns_per_session = $4
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: CreateCodeMember :one
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOrCreateCodeMember :one
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
ON CONFLICT (code_id, display_name) DO UPDATE SET last_seen_at = now()
RETURNING *;

-- name: GetCodeMemberByName :one
SELECT * FROM code_members WHERE code_id = $1 AND display_name = $2;

-- name: ListCodeMembers :many
SELECT * FROM code_members WHERE code_id = $1 ORDER BY last_seen_at DESC NULLS LAST;

-- name: TouchCodeMember :exec
UPDATE code_members SET last_seen_at = now() WHERE id = $1;

-- name: CountSessionsForMember :one
SELECT COUNT(*)::int FROM conversations WHERE member_id = $1;

-- name: CountVisitorTurnsInConversation :one
SELECT COUNT(*)::int FROM messages WHERE conversation_id = $1 AND role = 'visitor';
