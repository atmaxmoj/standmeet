-- name: CreateAccessRequest :one
INSERT INTO access_requests (owner_id, name, org, email, message)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, name, org, email, message, status, created_at;

-- name: ListAccessRequestsByOwner :many
SELECT id, owner_id, name, org, email, message, status, created_at FROM access_requests
WHERE owner_id = $1
  AND (sqlc.narg('status_filter')::text IS NULL OR status = sqlc.narg('status_filter'))
ORDER BY created_at DESC
LIMIT 100;

-- name: GetAccessRequestByID :one
SELECT id, owner_id, name, org, email, message, status, created_at FROM access_requests
WHERE id = $1 AND owner_id = $2;

-- name: UpdateAccessRequestStatus :one
UPDATE access_requests
SET status = $3
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, name, org, email, message, status, created_at;
