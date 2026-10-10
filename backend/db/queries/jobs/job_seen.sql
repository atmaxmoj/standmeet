-- name: InsertSeen :one
-- A posting the ledger does not hold yet; no row back when either key already has one.
INSERT INTO job_seen (owner_id, url_key, composite_key, first_run, source, snapshot)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: SeenByKeys :one
-- The ledger row a posting matches on either key (roadmap 4.1.a). An empty key matches nothing.
SELECT * FROM job_seen
WHERE owner_id = sqlc.arg('owner_id')
  AND ((url_key <> '' AND url_key = sqlc.arg('url_key')::text)
    OR (composite_key <> '' AND composite_key = sqlc.arg('composite_key')::text))
ORDER BY first_seen_at
LIMIT 1;

-- name: TouchSeen :exec
UPDATE job_seen SET last_seen_at = now() WHERE id = $1;

-- name: GetSeen :one
SELECT * FROM job_seen WHERE id = $1 AND owner_id = $2;

-- name: SetSeenStatus :exec
-- discarded (jobs.discard, 4.1.c) or applied with its application (commit, 8.4.b), by the
-- posting's keys.
UPDATE job_seen
SET status = sqlc.arg('status'), application_id = COALESCE(sqlc.narg('application_id'), application_id)
WHERE owner_id = sqlc.arg('owner_id')
  AND ((url_key <> '' AND url_key = sqlc.arg('url_key')::text)
    OR (composite_key <> '' AND composite_key = sqlc.arg('composite_key')::text));

-- name: AnnotateSeen :one
-- The AI's assessment, merged key by key over what is there (4.1.d, 8.2.a).
UPDATE job_seen SET annotations = annotations || sqlc.arg('annotations')::jsonb
WHERE id = sqlc.arg('id') AND owner_id = sqlc.arg('owner_id')
RETURNING *;

-- name: ListSeenPage :many
-- One page of the ledger, newest first (8.3.a, docs/design/paging.md): from/to bound first_seen_at
-- ([from, to)), status narrows.
SELECT * FROM job_seen
WHERE owner_id = sqlc.arg('owner_id')
  AND (sqlc.narg('from_at')::timestamptz IS NULL OR first_seen_at >= sqlc.narg('from_at'))
  AND (sqlc.narg('to_at')::timestamptz IS NULL OR first_seen_at < sqlc.narg('to_at'))
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (first_seen_at, id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY first_seen_at DESC, id DESC
LIMIT sqlc.arg('lim');

-- name: UpsertCompanyMark :exec
INSERT INTO company_marks (owner_id, company_key, mark, note) VALUES ($1, $2, $3, $4)
ON CONFLICT (owner_id, company_key) DO UPDATE SET mark = EXCLUDED.mark, note = EXCLUDED.note;

-- name: DeleteCompanyMark :exec
DELETE FROM company_marks WHERE owner_id = $1 AND company_key = $2;

-- name: ListCompanyMarks :many
SELECT company_key FROM company_marks WHERE owner_id = $1 AND mark = 'do_not_apply';
