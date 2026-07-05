-- name: CreateAccessCode :one
-- A.3-IAM-5：每张码必挂 assumed_role_id。corpus_permissions / granted_skills
-- 等 legacy 字段在 commit 5 drop，ACL / capability gating 全部从 role 推断。
INSERT INTO access_codes (
    owner_id, code, label, purpose, ghosts,
    expires_at, max_turns_per_session, max_bookings,
    assumed_role_id, max_members, prompt_id, inline_prompt
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: UpdateAccessCodeRole :one
-- Admin "reassign role"。新 role 必须属于同 owner（caller 校验过）。
UPDATE access_codes
SET assumed_role_id = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: UpdateAccessCodeMaxBookings :one
-- calendar.book 配额改。granted_skills 不再存在，这里只剩 max_bookings。
UPDATE access_codes
SET max_bookings = $3
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
SET max_turns_per_session = $3, max_members = $4
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: CountCodeMembers :one
-- max_members 强制用:这张码已经有几个不同名字(member)。
SELECT count(*) FROM code_members WHERE code_id = $1;

-- name: GetCodeMemberByID :one
-- 按 member id 取(client 存了 member_id,再来时凭 id 续会;尤其匿名者)。
-- 限定 code_id 防跨码串。
SELECT * FROM code_members WHERE id = $1 AND code_id = $2;

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

-- name: CountBookingsByCode :one
SELECT COUNT(*)::int FROM code_bookings WHERE code_id = $1;
