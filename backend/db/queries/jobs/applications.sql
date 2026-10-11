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
-- The outcome, and the follow-up its cadence sets (roadmap 3.1.b; jobsmodel.FollowupAfterOutcome):
-- a new outcome starts its nudges over.
UPDATE applications
SET outcome = sqlc.arg('outcome'), followup_nudges = 0,
    next_followup_at = sqlc.narg('next_followup_at')
WHERE id = sqlc.arg('id') AND owner_id = sqlc.arg('owner_id');

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

-- name: InsertApplicationAnswer :exec
-- One answer a form was filled with (roadmap 5.4.b).
INSERT INTO application_answers (owner_id, application_id, question_key, question, answer)
VALUES ($1, $2, $3, $4, $5);

-- name: LatestApplicationAnswers :many
-- The owner's latest answer per question.
SELECT DISTINCT ON (question_key) question_key, answer, application_id
FROM application_answers
WHERE owner_id = $1
ORDER BY question_key, created_at DESC;

-- name: ApplicationOwned :one
SELECT EXISTS (SELECT 1 FROM applications WHERE id = $1 AND owner_id = $2);

-- name: ApplicationExchanges :many
-- Every question a recruiter asked on the owner's application codes, with the agent's answer and
-- whether it stood on the corpus (job-loop roadmap 2.1): a citation, a grounded subjectivity note,
-- or a corpus_read that succeeded. application_id narrows to one application.
SELECT a.id AS application_id, c.id AS conversation_id, v.body AS question, v.created_at AS asked_at,
       COALESCE((SELECT m.body FROM messages m
                 WHERE m.dialog_id = d.id AND m.role = 'assistant'
                 ORDER BY m.created_at DESC LIMIT 1), '')::text AS answer,
       EXISTS (SELECT 1 FROM messages m
               WHERE m.dialog_id = d.id AND m.role = 'assistant'
                 AND (cardinality(m.cited_wiki_ids) + cardinality(m.cited_output_ids)
                      + cardinality(m.cited_subjectivity_ids) + cardinality(m.cited_writing_ids)
                      + cardinality(m.grounded_subjectivity_ids) > 0
                   OR jsonb_path_exists(COALESCE(m.tool_calls, '[]'::jsonb),
                        '$[*] ? (@.name == "corpus_read" && @.ok == true)'))) AS grounded
FROM applications a
JOIN conversations c ON c.code_id = a.access_code_id
JOIN dialogs d ON d.conversation_id = c.id
JOIN messages v ON v.dialog_id = d.id AND v.role = 'visitor'
WHERE a.owner_id = sqlc.arg('owner_id')
  AND (sqlc.narg('application_id')::uuid IS NULL OR a.id = sqlc.narg('application_id'))
ORDER BY v.created_at;
