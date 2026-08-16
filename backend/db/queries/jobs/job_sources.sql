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
-- 每一次取数都写一笔，成败都写。**「取过但每次都失败」和「从没取过」必须分得开** ——
-- 只记 last_fetched_at 的时候，两者在 /admin/sources 上是同一行字（F-E-18）。
-- 成功时 last_error 写空串（不是 NULL）：这一列永远有值，读的人不必分辨「没写」和「没错」。
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
