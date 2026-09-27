-- 2026-09-26-mail-jobs.sql — mail side effects travel as durable jobs
-- (docs/design/event-bus-outbox-webhooks.md, *Phase 4*). Reentrant: safe to run on a database
-- that already has it.

-- access_requests.mail_job_id —— the approval mail's job: its state is the row's mail state
-- (sending / sent / failed). NULL = no approval mail yet.
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS mail_job_id bigint NULL;

-- access_requests.notify_claimed_at —— this request took one of the owner's notification slots
-- (the email-bomb cap counts these per owner per hour). NULL = none taken (not yet, or dropped).
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS notify_claimed_at timestamptz NULL;

-- access_requests.notified_at —— the owner notification went out (send, then mark). A second
-- run of the same event sees it and sends nothing.
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS notified_at timestamptz NULL;

-- owners.pending_email_job_id —— the confirmation mail's job for the pending email change.
ALTER TABLE owners ADD COLUMN IF NOT EXISTS pending_email_job_id bigint NULL;
