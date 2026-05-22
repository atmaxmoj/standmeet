-- name: CreateApplication :one
INSERT INTO applications (owner_id, access_code_id, job_snapshot, resume_content)
VALUES ($1, $2, $3, $4)
RETURNING id, owner_id, access_code_id, job_snapshot, resume_content,
          status, submitted_at, created_at;

-- name: GetApplication :one
SELECT id, owner_id, access_code_id, job_snapshot, resume_content,
       status, submitted_at, created_at
FROM applications
WHERE id = $1 AND owner_id = $2;

-- name: ListApplicationsByOwner :many
SELECT id, owner_id, access_code_id, job_snapshot, resume_content,
       status, submitted_at, created_at
FROM applications
WHERE owner_id = $1
ORDER BY created_at DESC;
