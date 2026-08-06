-- owner_providers.sql —— the owner's provider book (one entry marked default).
--
-- Resolution order lives in Go (byoai > code > role > default); these queries only fetch. The two
-- rules that could be forgotten in code are in the schema instead: ON DELETE SET NULL makes a
-- deleted entry fall back to the default, and a partial unique index makes two defaults impossible.

-- name: CreateOwnerProvider :one
INSERT INTO owner_providers (owner_id, label, provider, key_enc, endpoint, model, is_default)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListOwnerProviders :many
SELECT * FROM owner_providers WHERE owner_id = $1 ORDER BY is_default DESC, label;

-- name: GetOwnerProvider :one
SELECT * FROM owner_providers WHERE id = $1 AND owner_id = $2;

-- name: GetDefaultOwnerProvider :one
SELECT * FROM owner_providers WHERE owner_id = $1 AND is_default;

-- name: UpdateOwnerProvider :one
-- Partial update: NULL keeps the stored value. key_enc has its own query — a key is not a field you
-- accidentally blank by omitting it.
UPDATE owner_providers
SET label      = COALESCE(sqlc.narg(label), label),
    provider   = COALESCE(sqlc.narg(provider), provider),
    endpoint   = COALESCE(sqlc.narg(endpoint), endpoint),
    model      = COALESCE(sqlc.narg(model), model),
    gas_tokens = CASE WHEN sqlc.arg(set_gas)::boolean THEN sqlc.narg(gas_tokens) ELSE gas_tokens END
WHERE id = sqlc.arg(id) AND owner_id = sqlc.arg(owner_id)
RETURNING *;

-- name: SetOwnerProviderKey :execrows
-- :execrows, not :exec — an id that is not there matches zero rows and postgres says nothing, and
-- "your key was saved" about a row that does not exist is the same lie as a revoke that revoked
-- nothing.
UPDATE owner_providers SET key_enc = $3 WHERE id = $1 AND owner_id = $2;

-- name: ClearDefaultOwnerProvider :exec
-- Idempotent by intent: "no entry of this owner is default any more". Zero rows is a legitimate
-- outcome (the owner had none), so no receipt is needed — unlike SetDefaultOwnerProvider below.
UPDATE owner_providers SET is_default = false WHERE owner_id = $1 AND is_default;

-- name: SetDefaultOwnerProvider :execrows
-- The caller clears first, then sets. Zero rows here means the target does not exist, which would
-- leave the owner with NO default at all — the one state the whole fallback story depends on.
UPDATE owner_providers SET is_default = true WHERE id = $1 AND owner_id = $2;

-- name: DeleteOwnerProvider :execrows
DELETE FROM owner_providers WHERE id = $1 AND owner_id = $2 AND NOT is_default;

-- name: CountOwnerProviders :one
SELECT COUNT(*)::int FROM owner_providers WHERE owner_id = $1;
