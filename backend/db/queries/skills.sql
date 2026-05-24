-- name: CreateSkill :one
INSERT INTO skills (
    owner_id, name, description, prompt, scripts, metadata,
    allowed_tools, is_builtin, version, license, source
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: UpsertBuiltinSkill :one
-- Seed built-in skills: idempotent by (owner_id, name). Overwrite prompt /
-- description / metadata 字段以便 future seed 调整后 re-run 生效。
INSERT INTO skills (
    owner_id, name, description, prompt, is_builtin, source
)
VALUES ($1, $2, $3, $4, true, 'builtin')
ON CONFLICT (owner_id, name) DO UPDATE SET
    description = EXCLUDED.description,
    prompt = EXCLUDED.prompt,
    updated_at = now()
RETURNING *;

-- name: GetSkillByID :one
SELECT * FROM skills WHERE id = $1 AND owner_id = $2;

-- name: ListSkillsByOwner :many
SELECT * FROM skills WHERE owner_id = $1 ORDER BY is_builtin DESC, name ASC;

-- name: DeleteSkill :exec
DELETE FROM skills WHERE id = $1 AND owner_id = $2 AND is_builtin = false;

-- name: UpdateSkill :one
UPDATE skills
SET name = $3, description = $4, prompt = $5, allowed_tools = $6, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: AttachCodeSkills :exec
-- 批量插 code_skills。caller 先 DELETE FROM code_skills WHERE code_id = $1
-- 再调本句 (UpdateCodeSkills usecase 那一对原子操作)。
INSERT INTO code_skills (code_id, skill_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: ClearCodeSkills :exec
DELETE FROM code_skills WHERE code_id = $1;

-- name: ListSkillsForCode :many
-- visitor session issue 时拿 code 的 skill 列表，拼 system prompt。
SELECT s.* FROM skills s
JOIN code_skills cs ON cs.skill_id = s.id
WHERE cs.code_id = $1
ORDER BY s.name ASC;

-- name: ListSkillIDsForCode :many
-- admin codes 列表回显时只要 id 数组，不必拉整 row。
SELECT skill_id FROM code_skills WHERE code_id = $1 ORDER BY skill_id;
