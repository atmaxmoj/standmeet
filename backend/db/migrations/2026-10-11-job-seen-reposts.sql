-- 2026-10-11-job-seen-reposts.sql — how often a company posted the same job again (job-loop roadmap
-- 1.5.b). Reentrant. Existing rows start at 0: the ledger never recorded a repost before.
ALTER TABLE job_seen ADD COLUMN IF NOT EXISTS reposts integer NOT NULL DEFAULT 0;
