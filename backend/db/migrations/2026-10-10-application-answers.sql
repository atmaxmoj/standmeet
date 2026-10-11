-- 2026-10-10-application-answers.sql — the answers an application form was filled with (job-loop
-- roadmap 5.4.b). Reentrant: safe to run on a database that already has it.
--
-- The next posting asking the same question (question_key: the label lower-cased, punctuation and
-- spacing collapsed) is offered the latest answer. An answer belongs to its application and goes
-- with it.
-- events: none (owner's working data)
CREATE TABLE IF NOT EXISTS application_answers (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    question_key   text        NOT NULL,
    question       text        NOT NULL,
    answer         text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_answers_owner_key_idx
    ON application_answers (owner_id, question_key, created_at DESC);
