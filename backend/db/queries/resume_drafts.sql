-- name: CreateResumeDraft :one
INSERT INTO resume_drafts (owner_id, job_cache_id, job_snapshot, resume_content)
VALUES ($1, $2, $3, $4)
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, expires_at, created_at;

-- name: GetResumeDraft :one
SELECT id, owner_id, job_cache_id, job_snapshot, resume_content, expires_at, created_at
FROM resume_drafts
WHERE id = $1 AND owner_id = $2 AND expires_at > now();

-- name: UpdateResumeDraftContent :one
UPDATE resume_drafts
SET resume_content = $3
WHERE id = $1 AND owner_id = $2 AND expires_at > now()
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, expires_at, created_at;

-- name: DeleteResumeDraft :exec
DELETE FROM resume_drafts WHERE id = $1 AND owner_id = $2;

-- name: SweepExpiredResumeDrafts :exec
DELETE FROM resume_drafts WHERE expires_at <= now();
