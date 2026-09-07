-- name: CreateResumeDraft :one
-- Drafts are created by the MCP resume.draft path (no Puck editor involved), so puck_data starts
-- NULL and is adopted on the first admin Save (UpdateResumeDraftFull).
INSERT INTO resume_drafts (owner_id, job_cache_id, job_snapshot, resume_content, template)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at;

-- name: GetResumeDraft :one
SELECT id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at
FROM resume_drafts
WHERE id = $1 AND owner_id = $2 AND expires_at > now();

-- name: UpdateResumeDraftContent :one
-- The MCP path: content only (no Puck editor state), so puck_data is left untouched — an
-- agent-written draft that a human later opens still derives puck_data from resume_content.
UPDATE resume_drafts
SET resume_content = $3
WHERE id = $1 AND owner_id = $2 AND expires_at > now()
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at;

-- name: UpdateResumeDraftFull :one
-- The admin composer's Save: the Puck editor state (puck_data), the derived canonical content, and
-- the chosen Typst template together, so a Save persists all three in one write. resume_content
-- stays the render source (typst renders from it); puck_data is editor fidelity, always rederivable
-- from resume_content (never a second source of truth).
UPDATE resume_drafts
SET resume_content = $3, template = $4, puck_data = $5
WHERE id = $1 AND owner_id = $2 AND expires_at > now()
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at;

-- name: DeleteResumeDraft :exec
DELETE FROM resume_drafts WHERE id = $1 AND owner_id = $2;

-- name: SweepExpiredResumeDrafts :exec
DELETE FROM resume_drafts WHERE expires_at <= now();

-- name: ListResumeDraftsByOwner :many
-- admin /drafts view: the owner's unexpired drafts, ordered by created_at desc.
SELECT id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at
FROM resume_drafts
WHERE owner_id = $1 AND expires_at > now()
ORDER BY created_at DESC;
