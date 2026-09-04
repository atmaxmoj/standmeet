-- prompts -- owner-scoped persona library. Semantics in schema.sql + [[iam-role-pivot-plan]].
--
-- public (is_builtin=true) is seeded by the SeedPublicRole upsert; ones the owner adds themselves
-- = false. Deleting a builtin is blocked at the repo layer (domain.ErrPromptBuiltinImmutable).

-- name: CreatePrompt :one
INSERT INTO prompts (owner_id, name, description, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpsertBuiltinPrompt :one
-- Seed builtin prompt: idempotent by (owner_id, name).
-- description / body are overwritten with EXCLUDED, so a future seed adjustment lands on re-run.
INSERT INTO prompts (owner_id, name, description, body, is_builtin)
VALUES ($1, $2, $3, $4, true)
ON CONFLICT (owner_id, name) DO UPDATE SET
    description = EXCLUDED.description,
    body        = EXCLUDED.body,
    updated_at  = now()
RETURNING *;

-- name: GetPromptByID :one
SELECT * FROM prompts WHERE id = $1 AND owner_id = $2;

-- name: GetPromptByName :one
SELECT * FROM prompts WHERE owner_id = $1 AND name = $2;

-- name: ListPromptsByOwner :many
SELECT * FROM prompts WHERE owner_id = $1 ORDER BY is_builtin DESC, name ASC;

-- name: UpdatePrompt :one
-- Builtin (public) can also update body / description (the owner tweaks the public copy);
-- the repo layer rejects builtin rename + delete.
UPDATE prompts
SET name = $3, description = $4, body = $5, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: DeletePrompt :exec
-- Deletes non-builtin only; builtin is never allowed to be deleted (blocked by the repo layer above).
DELETE FROM prompts WHERE id = $1 AND owner_id = $2 AND is_builtin = false;
