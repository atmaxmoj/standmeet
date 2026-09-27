-- name: CreateAccessRequest :one
INSERT INTO access_requests (owner_id, name, org, email, message)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, name, org, email, message, status, created_at, mail_job_id;

-- name: ListAccessRequestsPage :many
-- One page, newest first (docs/design/paging.md). It used to be a flat LIMIT 100: the 101st
-- request was unreachable. total: how many match the filter on every page (evaluated once).
SELECT id, owner_id, name, org, email, message, status, created_at, mail_job_id,
  (SELECT COUNT(*) FROM access_requests a2 WHERE a2.owner_id = sqlc.arg('owner_id')
    AND (sqlc.narg('status_filter')::text IS NULL OR a2.status = sqlc.narg('status_filter')))::int AS total
FROM access_requests
WHERE owner_id = sqlc.arg('owner_id')
  AND (sqlc.narg('status_filter')::text IS NULL OR status = sqlc.narg('status_filter'))
  -- id: one request (the panel re-reads a row whose approval mail is still sending).
  AND (sqlc.narg('only_id')::uuid IS NULL OR id = sqlc.narg('only_id'))
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (created_at, id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('lim');

-- name: GetAccessRequestByID :one
SELECT id, owner_id, name, org, email, message, status, created_at, mail_job_id FROM access_requests
WHERE id = $1 AND owner_id = $2;

-- name: UpdateAccessRequestStatus :one
UPDATE access_requests
SET status = $3
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, name, org, email, message, status, created_at, mail_job_id;

-- name: SetAccessRequestMailJob :execrows
UPDATE access_requests
SET mail_job_id = $3
WHERE id = $1 AND owner_id = $2;
