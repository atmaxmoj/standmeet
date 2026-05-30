-- prompts —— owner-scoped persona library。语义见 schema.sql + [[iam-role-pivot-plan]]。
--
-- vanilla（is_builtin=true）由 SeedVanillaRole upsert 种入；owner 自己加的
-- = false。删除 builtin 在 repo 层挡（domain.ErrPromptBuiltinImmutable）。

-- name: CreatePrompt :one
INSERT INTO prompts (owner_id, name, description, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpsertBuiltinPrompt :one
-- Seed builtin prompt：idempotent by (owner_id, name)。
-- description / body 用 EXCLUDED 覆盖，让 future seed 调整后 re-run 能落地。
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
-- Builtin (vanilla) 也能 update body / description（owner 调 vanilla 文案）；
-- repo 层拒 builtin rename + delete。
UPDATE prompts
SET name = $3, description = $4, body = $5, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: DeletePrompt :exec
-- 只删 non-builtin；builtin 永远不允许删（repo 上层挡）。
DELETE FROM prompts WHERE id = $1 AND owner_id = $2 AND is_builtin = false;
