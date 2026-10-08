-- name: CreateResumeDraft :one
-- Drafts are created by the MCP resume.draft path (no Puck editor involved), so puck_data starts
-- NULL and is adopted on the first admin Save (UpdateResumeDraftFull). based_on_master_id names the
-- master the content was copied from (NULL = blank or agent-written).
INSERT INTO resume_drafts (owner_id, job_cache_id, job_snapshot, resume_content, template, based_on_master_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at, based_on_master_id;

-- name: GetResumeDraft :one
SELECT sqlc.embed(d), COALESCE(m.name, '')::text AS based_on_master_name
FROM resume_drafts d
LEFT JOIN resume_masters m ON m.id = d.based_on_master_id AND m.deleted_at IS NULL
WHERE d.id = $1 AND d.owner_id = $2 AND d.expires_at > now();

-- name: UpdateResumeDraftContent :one
-- The MCP path: content only (no Puck editor state), so puck_data is left untouched — an
-- agent-written draft that a human later opens still derives puck_data from resume_content.
UPDATE resume_drafts
SET resume_content = $3
WHERE id = $1 AND owner_id = $2 AND expires_at > now()
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at, based_on_master_id;

-- name: UpdateResumeDraftFull :one
-- The admin composer's Save: the Puck editor state (puck_data), the derived canonical content, and
-- the chosen Typst template together, so a Save persists all three in one write. resume_content
-- stays the render source (typst renders from it); puck_data is editor fidelity, always rederivable
-- from resume_content (never a second source of truth).
UPDATE resume_drafts
SET resume_content = $3, template = $4, puck_data = $5
WHERE id = $1 AND owner_id = $2 AND expires_at > now()
RETURNING id, owner_id, job_cache_id, job_snapshot, resume_content, puck_data, template, expires_at, created_at, based_on_master_id;

-- name: DeleteResumeDraft :exec
DELETE FROM resume_drafts WHERE id = $1 AND owner_id = $2;

-- name: SweepExpiredResumeDrafts :exec
DELETE FROM resume_drafts WHERE expires_at <= now();

-- name: CountResumeDrafts :one
-- How many unexpired drafts the owner has across every page (the drafts header count).
SELECT COUNT(*)::int FROM resume_drafts WHERE owner_id = $1 AND expires_at > now();

-- name: ListResumeDraftsPage :many
-- One page of the admin /drafts view (docs/design/paging.md): unexpired drafts, newest first, each
-- with the name of the master it came from ('' = none).
SELECT sqlc.embed(d), COALESCE(m.name, '')::text AS based_on_master_name
FROM resume_drafts d
LEFT JOIN resume_masters m ON m.id = d.based_on_master_id AND m.deleted_at IS NULL
WHERE d.owner_id = sqlc.arg('owner_id') AND d.expires_at > now()
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (d.created_at, d.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY d.created_at DESC, d.id DESC
LIMIT sqlc.arg('lim');
