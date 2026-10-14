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
-- The ledger saw the posting again. Under a new URL more than 7 days after it last saw it, the
-- company posted it again (roadmap 1.5.b): reposts goes up.
UPDATE job_seen
SET reposts = reposts + (url_key <> '' AND sqlc.arg('url_key')::text <> ''
        AND url_key <> sqlc.arg('url_key')::text
        AND last_seen_at < now() - interval '7 days')::int,
    last_seen_at = now()
WHERE id = sqlc.arg('id');

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

-- name: SeenURLs :many
-- Every posting link in the owner's ledger: the boards they point at are suggested as direct
-- sources (roadmap 4.3.d).
SELECT COALESCE(snapshot->>'url', '')::text AS url FROM job_seen WHERE owner_id = $1;

-- ── retention (docs/design/job-loop-retention.md): the row's clock is a retention_bundles row ──

-- name: SeenClockState :one
-- The row's bundle and whether its assessment was cleared (read before an annotate).
SELECT bundle_id, cleared_at FROM job_seen WHERE id = $1 AND owner_id = $2 FOR UPDATE;

-- name: NewBundleForSeen :exec
-- An ephemeral assessment with no clock gets its own one-member bundle.
WITH b AS (INSERT INTO retention_bundles (owner_id) VALUES (sqlc.arg('owner_id')) RETURNING id)
UPDATE job_seen SET bundle_id = (SELECT id FROM b)
WHERE job_seen.id = sqlc.arg('id') AND job_seen.owner_id = sqlc.arg('owner_id');

-- name: JoinSeenBundle :execrows
-- Join the owner's live bundle (an assessment sharing a microsite's clock, or a batch).
UPDATE job_seen SET bundle_id = sqlc.arg('bundle_id')
WHERE job_seen.id = sqlc.arg('id') AND job_seen.owner_id = sqlc.arg('owner_id')
  AND EXISTS (SELECT 1 FROM retention_bundles b WHERE b.id = sqlc.arg('bundle_id')
              AND b.owner_id = sqlc.arg('owner_id') AND b.cleared_at IS NULL);

-- name: TouchSeenBundle :exec
UPDATE retention_bundles b SET last_touched_at = now()
FROM job_seen s
WHERE s.id = $1 AND s.owner_id = $2 AND b.id = s.bundle_id AND b.cleared_at IS NULL;

-- name: PinSeenBundle :execrows
UPDATE retention_bundles b SET keep = $3, last_touched_at = now()
FROM job_seen s
WHERE s.id = $1 AND s.owner_id = $2 AND b.id = s.bundle_id AND b.cleared_at IS NULL;

-- name: ForgetSeenBundle :exec
-- retention: forever. Deleting the bundle makes every member forever (ON DELETE SET NULL).
DELETE FROM retention_bundles b USING job_seen s
WHERE s.id = $1 AND s.owner_id = $2 AND b.id = s.bundle_id;

-- name: ForgetBundleByKeys :exec
-- A commit: the posting's bundle (assessment, page, code) becomes forever.
DELETE FROM retention_bundles b USING job_seen s
WHERE s.owner_id = sqlc.arg('owner_id') AND b.id = s.bundle_id
  AND ((s.url_key <> '' AND s.url_key = sqlc.arg('url_key')::text)
    OR (s.composite_key <> '' AND s.composite_key = sqlc.arg('composite_key')::text));

-- name: BundleClocks :many
SELECT id, keep, last_touched_at FROM retention_bundles WHERE id = ANY(sqlc.arg('ids')::uuid[]);

-- name: ClearBundleAssessments :exec
-- The bundle expired: its assessments move to the trash; each row keeps its tombstone.
WITH moved AS (
    INSERT INTO job_assessment_trash (job_seen_id, owner_id, annotations)
    SELECT s.id, s.owner_id, s.annotations FROM job_seen s
    WHERE s.bundle_id = sqlc.arg('bundle_id')::uuid AND s.cleared_at IS NULL
    ON CONFLICT (job_seen_id) DO UPDATE
        SET annotations = EXCLUDED.annotations, cleared_at = now()
    RETURNING job_assessment_trash.job_seen_id
)
UPDATE job_seen SET annotations = '{}', cleared_at = now()
WHERE job_seen.id IN (SELECT job_seen_id FROM moved);

-- name: RestoreBundleAssessments :exec
WITH back AS (
    DELETE FROM job_assessment_trash t USING job_seen s
    WHERE t.job_seen_id = s.id AND s.bundle_id = $1
    RETURNING t.job_seen_id, t.annotations
)
UPDATE job_seen SET annotations = back.annotations, cleared_at = NULL
FROM back WHERE job_seen.id = back.job_seen_id;

-- name: PurgeAssessmentTrash :execrows
DELETE FROM job_assessment_trash WHERE cleared_at < $1;

-- name: AppendInterviewReport :exec
-- One practice-interview report onto the row's interview_reports, in one statement
-- (docs/design/deepinterview-engine.md): concurrent appends never lose one.
UPDATE job_seen
SET annotations = jsonb_set(annotations, '{interview_reports}',
    COALESCE(annotations->'interview_reports', '[]'::jsonb)
        || jsonb_build_array(sqlc.arg('report')::text))
WHERE id = sqlc.arg('id') AND owner_id = sqlc.arg('owner_id');
