-- name: CreateApplication :one
-- id is caller-supplied so the final PDF (which embeds the application id in its print URL) can be
-- rendered BEFORE this irreversible commit — a render failure then persists nothing (retryable),
-- instead of stranding a committed application with no PDF.
INSERT INTO applications (id, owner_id, access_code_id, job_snapshot, resume_content)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, access_code_id, job_snapshot, resume_content,
          status, submitted_at, created_at;

-- name: GetApplication :one
SELECT id, owner_id, access_code_id, job_snapshot, resume_content,
       status, submitted_at, created_at
FROM applications
WHERE id = $1 AND owner_id = $2;

-- name: GetApplicationByAccessCode :one
-- Look up the application bound to a session's access code. owner-scoped (defense in depth;
-- access_code_id is already globally unique). The visitor-side resume tool uses it to lock "which one" to this code.
SELECT id, owner_id, access_code_id, job_snapshot, resume_content,
       status, submitted_at, created_at
FROM applications
WHERE access_code_id = $1 AND owner_id = $2;

-- name: ListApplicationsByOwner :many
SELECT id, owner_id, access_code_id, job_snapshot, resume_content,
       status, submitted_at, created_at
FROM applications
WHERE owner_id = $1
ORDER BY created_at DESC;
