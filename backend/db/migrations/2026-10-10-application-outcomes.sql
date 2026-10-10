-- 2026-10-10-application-outcomes.sql — an application's outcome, separate from its submission
-- status (job-loop roadmap E1). Reentrant: safe to run on a database that already has it.
--
-- status says how the sending went (pending / submitted / failed); outcome says what came of it
-- (none / responded / interview / offer / rejected / hired / withdrawn), set by the owner. Every
-- change of outcome appends a row to application_outcomes, so the timeline shows what really
-- happened, in order. Withdrawing is the owner's decision, not a result of sending, so a row that
-- carried status='withdrawn' moves to outcome='withdrawn' and back to status='submitted'.
--
-- engaged_at: when the recruiter first talked on the application's code — only there to make
-- application.engaged fire once (a guarded update), never shown.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'none';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS engaged_at timestamptz NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_outcome_check') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_outcome_check CHECK (outcome IN
            ('none', 'responded', 'interview', 'offer', 'rejected', 'hired', 'withdrawn'));
    END IF;
END $$;

UPDATE applications SET outcome = 'withdrawn', status = 'submitted' WHERE status = 'withdrawn';

-- events: none (application.outcome_changed is recorded by the jobs use case with the row)
CREATE TABLE IF NOT EXISTS application_outcomes (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    from_outcome   text        NOT NULL,
    to_outcome     text        NOT NULL,
    note           text        NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_outcomes_app_idx ON application_outcomes(application_id, created_at);

-- An application's reach, read from where the facts already are (roadmap 1.1.b).
CREATE OR REPLACE FUNCTION application_opened_at(p_code uuid) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT LEAST(
        (SELECT min(created_at) FROM visit_event WHERE code_id = p_code AND NOT is_bot),
        (SELECT min(started_at) FROM conversations WHERE code_id = p_code))
$$;
CREATE OR REPLACE FUNCTION application_questions(p_code uuid) RETURNS int
LANGUAGE sql STABLE AS $$
    SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.code_id = p_code AND m.role = 'visitor'
$$;
