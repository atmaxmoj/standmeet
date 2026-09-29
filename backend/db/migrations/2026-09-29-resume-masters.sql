-- 2026-09-29-resume-masters.sql — résumé masters (docs/design/resume-masters.md). Reentrant: safe to
-- run on a database that already has them.
--
-- A draft lives one day; before this the only lasting copy of a résumé was an application row. A
-- master is a named, persistent résumé: resume_content only (no job, no access code, no expiry). An
-- owner has 0..N masters and at most one default. A draft records the master it started from; the
-- master may be deleted later, and then the draft simply names none.
-- events: none (owner configuration)
CREATE TABLE IF NOT EXISTS resume_masters (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name           text        NOT NULL,
    resume_content jsonb       NOT NULL,
    is_default     boolean     NOT NULL DEFAULT false,
    -- from_company —— the company of the draft this master was last saved from ('' = written here or
    -- blank). A label, not a reference: the draft expires within a day.
    from_company   text        NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_masters_owner_page_idx ON resume_masters(owner_id, created_at DESC, id DESC);
-- At most one default per owner: the database says so, not the code.
CREATE UNIQUE INDEX IF NOT EXISTS resume_masters_one_default ON resume_masters(owner_id) WHERE is_default;

ALTER TABLE resume_drafts
    ADD COLUMN IF NOT EXISTS based_on_master_id uuid REFERENCES resume_masters(id) ON DELETE SET NULL;
