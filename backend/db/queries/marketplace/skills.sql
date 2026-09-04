-- name: CreateSkill :one
INSERT INTO skills (
    owner_id, name, description, prompt, scripts, metadata,
    allowed_tools, is_builtin, version, license, source
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: UpsertBuiltinSkill :one
-- Seed built-in skills: idempotent by (owner_id, name). Overwrite prompt /
-- description / metadata fields so a re-run takes effect after a future seed adjustment.
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
-- Owner edits the body of their own skill and the tools it may call. In the design source's words: installing
-- "writes a local copy you fully own —— you can then edit its prompt or allowed-tools, decoupled from the marketplace".
--
-- `is_builtin = false` is the same predicate as DeleteSkill: the built-in ones are upserted by the seeder on every
-- boot (UpsertBuiltin overwrites description/prompt), so an edit made here is gone on the next boot —— an edit that
-- saves yet vanishes on its own is worse than disallowing it. 0 rows matched is the receipt; the caller uses it to distinguish builtin/not-found.
UPDATE skills
SET name = $3, description = $4, prompt = $5, allowed_tools = $6, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND is_builtin = false
RETURNING *;

-- name: SetSkillEnabled :one
-- #48-2: owner globally enables/disables a skill (builtins can be toggled too).
UPDATE skills
SET enabled = $3, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- A.3-IAM-5: AttachCodeSkills / ClearCodeSkills / ListSkillsForCode /
-- ListSkillIDsForCode were all removed —— the code_skills table was dropped; skills now hang off the
-- Role via role_skills.
