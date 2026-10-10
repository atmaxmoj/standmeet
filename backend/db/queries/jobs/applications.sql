-- name: CreateApplication :one
-- id is caller-supplied so the final PDF (which embeds the application id in its print URL) can be
-- rendered BEFORE this irreversible commit — a render failure then persists nothing (retryable),
-- instead of stranding a committed application with no PDF.
INSERT INTO applications (id, owner_id, access_code_id, job_snapshot, resume_content)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetApplication :one
-- One application with its reach: opened_at / questions come from where those facts already are
-- (visits, conversations, messages — application_opened_at / application_questions), never a column.
SELECT sqlc.embed(a),
       application_opened_at(a.access_code_id) AS opened_at,
       application_questions(a.access_code_id) AS questions
FROM applications a
WHERE a.id = $1 AND a.owner_id = $2;

-- name: GetApplicationByAccessCode :one
-- Look up the application bound to a session's access code. owner-scoped (defense in depth;
-- access_code_id is already globally unique). The visitor-side resume tool uses it to lock "which one" to this code.
SELECT sqlc.embed(a),
       application_opened_at(a.access_code_id) AS opened_at,
       application_questions(a.access_code_id) AS questions
FROM applications a
WHERE a.access_code_id = $1 AND a.owner_id = $2;

-- name: CountApplications :one
-- How many applications the owner has in all, search or not: the header counts what was
-- committed, and "no matches" is an empty page with a non-zero total.
SELECT COUNT(*)::int FROM applications WHERE owner_id = $1;

-- name: ListApplicationsPage :many
-- One page of the owner's applications, newest first (docs/design/paging.md). q: case-insensitive
-- substring of the company, the role, the status or the outcome (the recruiter calls; the owner
-- types the company). The page's total comes from CountApplications, not a column here: a search
-- that matches nothing returns no rows to carry it.
SELECT sqlc.embed(a),
       application_opened_at(a.access_code_id) AS opened_at,
       application_questions(a.access_code_id) AS questions
FROM applications a
WHERE a.owner_id = sqlc.arg('owner_id')
  AND (sqlc.arg('q')::text = ''
    OR (a.job_snapshot->>'company') ILIKE '%' || sqlc.arg('q') || '%'
    OR (a.job_snapshot->>'title') ILIKE '%' || sqlc.arg('q') || '%'
    OR a.status ILIKE '%' || sqlc.arg('q') || '%'
    OR a.outcome ILIKE '%' || sqlc.arg('q') || '%')
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (a.created_at, a.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg('lim');

-- name: ListApplicationsByCompany :many
-- The owner's earlier applications to one company (roadmap 1.5.a), matched on the trimmed,
-- lower-cased company name the job snapshot carries. Newest first.
SELECT sqlc.embed(a),
       application_opened_at(a.access_code_id) AS opened_at,
       application_questions(a.access_code_id) AS questions
FROM applications a
WHERE a.owner_id = sqlc.arg('owner_id')
  AND lower(btrim(a.job_snapshot->>'company')) = lower(btrim(sqlc.arg('company')::text))
ORDER BY a.created_at DESC, a.id DESC
LIMIT 20;

-- name: LockApplicationOutcome :one
-- The current outcome, row locked for the change that follows in the same transaction.
SELECT outcome, access_code_id FROM applications
WHERE id = $1 AND owner_id = $2
FOR UPDATE;

-- name: SetApplicationOutcome :exec
UPDATE applications SET outcome = $3 WHERE id = $1 AND owner_id = $2;

-- name: InsertApplicationOutcome :exec
INSERT INTO application_outcomes (application_id, from_outcome, to_outcome, note)
VALUES ($1, $2, $3, $4);

-- name: ListApplicationOutcomes :many
-- The timeline of one application's outcome, oldest first.
SELECT from_outcome, to_outcome, note, created_at FROM application_outcomes
WHERE application_id = $1
ORDER BY created_at, id;

-- name: MarkApplicationEngaged :one
-- The guard that makes application.engaged fire once: only the first conversation on the code
-- changes a row (engaged_at was NULL); every later one updates nothing and returns no row.
UPDATE applications SET engaged_at = now()
WHERE access_code_id = $1 AND engaged_at IS NULL
RETURNING id, owner_id;
