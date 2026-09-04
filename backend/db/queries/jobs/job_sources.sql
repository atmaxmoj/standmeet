-- name: CreateJobSource :one
INSERT INTO job_sources (owner_id, kind, config, label)
VALUES ($1, $2, $3, $4)
RETURNING id, owner_id, kind, config, label, last_fetched_at,
          last_attempted_at, last_error, created_at;

-- name: GetJobSource :one
SELECT id, owner_id, kind, config, label, last_fetched_at,
       last_attempted_at, last_error, created_at
FROM job_sources
WHERE id = $1 AND owner_id = $2;

-- name: ListJobSourcesByOwner :many
SELECT id, owner_id, kind, config, label, last_fetched_at,
       last_attempted_at, last_error, created_at
FROM job_sources
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: DeleteJobSource :exec
DELETE FROM job_sources WHERE id = $1 AND owner_id = $2;

-- name: TouchJobSourceFetched :exec
UPDATE job_sources SET last_fetched_at = now() WHERE id = $1;

-- name: MarkJobSourceAttempt :exec
-- Record every fetch attempt, success or failure. **"fetched but always failed" and "never fetched" must be
-- distinguishable** —— when only last_fetched_at is recorded, the two read as the same line on /admin/sources (F-E-18).
-- On success last_error is written as an empty string (not NULL): this column always has a value, so the reader need not tell "not written" from "no error".
UPDATE job_sources
SET last_attempted_at = now(), last_error = $2
WHERE id = $1;

-- name: InsertJobFingerprint :exec
INSERT INTO job_fingerprints (source_id, external_id)
VALUES ($1, $2)
ON CONFLICT (source_id, external_id) DO NOTHING;

-- name: GetExistingFingerprints :many
SELECT external_id FROM job_fingerprints
WHERE source_id = $1 AND external_id = ANY($2::text[]);
