-- code_denials —— ACL hierarchy 的 code 层（capability-acl-hierarchy.md）。
-- 纯 deny 稀疏表：presence=deny，无 state；无行=完全继承 role。owner-scope 由
-- handler 先 GetByID 校验 code 属本 owner，这里只按 code_id 读写。

-- name: AddCodeCapabilityDenial :exec
-- 幂等：重复 deny 同一 (code,cap) 走 PK 冲突 → 不报错、不双写。
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
