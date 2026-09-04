-- code_denials -- the code layer of the ACL hierarchy (capability-acl-hierarchy.md).
-- A pure-deny sparse table: presence=deny, no state; no rows=fully inherit the role. Owner-scope is
-- handled by the handler first calling GetByID to verify the code belongs to this owner; here we
-- read/write by code_id only.

-- name: AddCodeCapabilityDenial :exec
-- Idempotent: re-denying the same (code,cap) hits the PK conflict -> no error, no double write.
INSERT INTO code_capability_denials (code_id, capability_id)
VALUES ($1, $2)
ON CONFLICT (code_id, capability_id) DO NOTHING;

-- name: DeleteCodeCapabilityDenial :exec
DELETE FROM code_capability_denials WHERE code_id = $1 AND capability_id = $2;

-- name: ListCodeCapabilityDenials :many
SELECT capability_id FROM code_capability_denials WHERE code_id = $1;

-- name: AddCodeSkillDenial :exec
INSERT INTO code_skill_denials (code_id, skill_id)
VALUES ($1, $2)
ON CONFLICT (code_id, skill_id) DO NOTHING;

-- name: DeleteCodeSkillDenial :exec
DELETE FROM code_skill_denials WHERE code_id = $1 AND skill_id = $2;

-- name: ListCodeSkillDenials :many
SELECT skill_id FROM code_skill_denials WHERE code_id = $1;
