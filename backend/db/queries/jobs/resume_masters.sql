-- resume_masters —— named, persistent résumés (docs/design/resume-masters.md). A deleted master waits
-- in the trash (deleted_at set) for 90 days: every read below except the trash's own filters it.

-- name: CreateResumeMaster :one
INSERT INTO resume_masters (owner_id, name, resume_content, from_company)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetResumeMaster :one
SELECT * FROM resume_masters WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL;

-- name: GetDefaultResumeMaster :one
SELECT * FROM resume_masters WHERE owner_id = $1 AND is_default AND deleted_at IS NULL;

-- name: UpdateResumeMaster :one
-- A partial update: a NULL argument keeps the column (rename alone must not blank the content).
UPDATE resume_masters
SET name           = COALESCE(sqlc.narg('name'), name),
    resume_content = COALESCE(sqlc.narg('resume_content'), resume_content),
    from_company   = COALESCE(sqlc.narg('from_company'), from_company),
    updated_at     = now()
WHERE id = sqlc.arg('id') AND owner_id = sqlc.arg('owner_id') AND deleted_at IS NULL
RETURNING *;

-- name: ClearDefaultResumeMaster :exec
-- Step one of "make X the default" (same transaction as SetDefaultResumeMaster): the partial unique
-- index allows one default per owner, and it is checked row by row, so the old one goes first.
UPDATE resume_masters SET is_default = false WHERE owner_id = $1 AND is_default;

-- name: SetDefaultResumeMaster :execrows
UPDATE resume_masters SET is_default = true WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL;

-- name: DeleteResumeMaster :execrows
-- Into the trash: a trashed master is never the default (the index counts live masters only).
UPDATE resume_masters SET deleted_at = now(), is_default = false
WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL;

-- name: CountResumeMasters :one
SELECT COUNT(*)::int FROM resume_masters WHERE owner_id = $1 AND deleted_at IS NULL;

-- name: ListResumeMastersPage :many
-- One page of the owner's masters, newest first (docs/design/paging.md).
SELECT * FROM resume_masters
WHERE owner_id = sqlc.arg('owner_id') AND deleted_at IS NULL
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (created_at, id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('lim');

-- name: ListTrashedResumeMasters :many
-- The trash: newest delete first. Small by nature (a handful of masters per owner, 90 days).
SELECT id, name, deleted_at::timestamptz AS deleted_at FROM resume_masters
WHERE owner_id = $1 AND deleted_at IS NOT NULL
ORDER BY deleted_at DESC, id DESC;

-- name: RestoreResumeMaster :execrows
UPDATE resume_masters SET deleted_at = NULL, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL;

-- name: PurgeTrashedResumeMasters :execrows
DELETE FROM resume_masters WHERE deleted_at < sqlc.arg('before')::timestamptz;
