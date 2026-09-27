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

-- name: CountApplications :one
-- How many applications the owner has in all, search or not: the header counts what was
-- committed, and "no matches" is an empty page with a non-zero total.
SELECT COUNT(*)::int FROM applications WHERE owner_id = $1;

-- name: ListApplicationsPage :many
-- One page of the owner's applications, newest first (docs/design/paging.md). q: case-insensitive
-- substring of the company, the role or the status (the recruiter calls; the owner types the
-- company). The page's total comes from CountApplications, not a column here: a search that
-- matches nothing returns no rows to carry it.
SELECT sqlc.embed(a)
FROM applications a
WHERE a.owner_id = sqlc.arg('owner_id')
  AND (sqlc.arg('q')::text = ''
    OR (a.job_snapshot->>'company') ILIKE '%' || sqlc.arg('q') || '%'
    OR (a.job_snapshot->>'title') ILIKE '%' || sqlc.arg('q') || '%'
    OR a.status ILIKE '%' || sqlc.arg('q') || '%')
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (a.created_at, a.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg('lim');
