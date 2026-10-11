-- name: DueFollowups :many
-- Applications whose follow-up is due (roadmap 3.1): the time has passed, fewer than two nudges,
-- and not an application someone opened with no outcome yet (never nudged blind). owner_id
-- narrows to one owner (NULL = every owner, for the daily task).
SELECT sqlc.embed(a), application_opened_at(a.access_code_id) AS opened_at,
       application_questions(a.access_code_id) AS questions
FROM applications a
WHERE (sqlc.narg('owner_id')::uuid IS NULL OR a.owner_id = sqlc.narg('owner_id'))
  AND a.next_followup_at <= now() AND a.followup_nudges < 2
  AND NOT (a.outcome = 'none' AND application_opened_at(a.access_code_id) IS NOT NULL)
ORDER BY a.next_followup_at;

-- name: AdvanceFollowup :one
-- One nudge taken: the marker moves on. Guarded on the due time, so a second runner (or a rerun)
-- finds nothing to take.
UPDATE applications
SET followup_nudges = followup_nudges + 1, next_followup_at = sqlc.narg('next_followup_at')
WHERE id = sqlc.arg('id') AND next_followup_at <= now()
RETURNING id, owner_id, access_code_id, followup_nudges;

-- name: FunnelRows :many
-- Every application of the owner with what it reached (roadmap 3.2.a): its journal's outcomes,
-- when it was opened, and when its first outcome came.
SELECT a.id, a.created_at, a.outcome,
       application_opened_at(a.access_code_id) AS opened_at,
       (SELECT min(o.created_at) FROM application_outcomes o
        WHERE o.application_id = a.id)::timestamptz AS first_outcome_at,
       COALESCE((SELECT array_agg(DISTINCT o.to_outcome) FROM application_outcomes o
                 WHERE o.application_id = a.id), '{}')::text[] AS reached
FROM applications a
WHERE a.owner_id = $1;
