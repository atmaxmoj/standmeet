-- code_denials -- the code layer of the ACL hierarchy (block-acl-hierarchy.md).
-- A pure-deny sparse table: presence=deny, no state; no rows=fully inherit the role. Owner-scope is
-- handled by the handler first calling GetByID to verify the code belongs to this owner; here we
-- read/write by code_id only.

-- name: AddCodeBlockDenial :exec
-- Idempotent: re-denying the same (code,block) hits the PK conflict -> no error, no double write.
INSERT INTO code_block_denials (code_id, block_id)
VALUES ($1, $2)
ON CONFLICT (code_id, block_id) DO NOTHING;

-- name: DeleteCodeBlockDenial :exec
DELETE FROM code_block_denials WHERE code_id = $1 AND block_id = $2;

-- name: ListCodeBlockDenials :many
SELECT block_id FROM code_block_denials WHERE code_id = $1;

-- name: AddCodeSkillDenial :exec
INSERT INTO code_skill_denials (code_id, skill_id)
VALUES ($1, $2)
ON CONFLICT (code_id, skill_id) DO NOTHING;

-- name: DeleteCodeSkillDenial :exec
DELETE FROM code_skill_denials WHERE code_id = $1 AND skill_id = $2;

-- name: ListCodeSkillDenials :many
SELECT skill_id FROM code_skill_denials WHERE code_id = $1;
