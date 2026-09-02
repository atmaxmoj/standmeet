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
-- 按 session 的 access code 反查它绑的那一份 application。owner-scoped(纵深防御；
-- access_code_id 已全局唯一)。访客侧简历工具用它把"哪一份"锁到这张码上。
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
