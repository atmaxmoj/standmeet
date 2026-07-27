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

-- name: SetSkillEnabled :one
-- #48-2: owner 全局开/关一个 skill(builtin 也可开关)。
UPDATE skills
SET enabled = $3, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- A.3-IAM-5: AttachCodeSkills / ClearCodeSkills / ListSkillsForCode /
-- ListSkillIDsForCode 都删了 —— code_skills 表已 drop，skills 通过
-- role_skills 挂在 Role 上。
