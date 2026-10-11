-- 2026-10-11-application-followups.sql — when an application is next due a follow-up, and how many
-- nudges it has had (job-loop roadmap 3.1). Reentrant: safe to run on a database that already has
-- them.
--
-- A commit sets next_followup_at a week out (the column default). A daily task announces each due
-- application once (application.followup_due) and moves the marker on in the same transaction.
-- After two nudges without an answer the application is cold. Existing applications are backfilled
-- from their commit time, so one committed ten days ago is due once, not once per missed week.
-- Named 2026-10-11 so it runs after 2026-10-10-application-outcomes.sql: the backfill reads
-- applications.outcome. (Named 10-10 it ran first on an upgraded volume and failed.)
-- events: application.followup_due (recorded by the follow-up task, on its transaction)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS next_followup_at timestamptz NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS followup_nudges int NOT NULL DEFAULT 0;
UPDATE applications SET next_followup_at = created_at + interval '7 days'
WHERE next_followup_at IS NULL AND outcome IN ('none', 'responded', 'interview');
ALTER TABLE applications ALTER COLUMN next_followup_at SET DEFAULT now() + interval '7 days';
