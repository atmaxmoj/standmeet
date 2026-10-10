-- 2026-10-10-job-seen.sql — the owner's seen ledger and company marks (job-loop roadmap 4.1, E8).
-- Reentrant: safe to run on a database that already has them.
--
-- job_seen holds every posting a board or Job Scout ever showed the owner, keyed on the canonical URL
-- and on company::title::location (the dedup layer's keys). It is not tied to job_sources: removing
-- a source keeps what was seen. A later fetch drops what it holds; status says what the owner did.
-- first_run names the fetch (or jobs.record call) that first saw it: within one fetch, a posting two
-- sources share is left to the cross-source layer.
--
-- company_marks: companies the owner will not apply to, on the dedup layer's normalized name. A
-- posting's flag is read from here when it is read, never stored on the posting.
CREATE TABLE IF NOT EXISTS job_seen (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    url_key        text        NOT NULL DEFAULT '',
    composite_key  text        NOT NULL DEFAULT '',
    first_run      text        NOT NULL DEFAULT '',
    source         text        NOT NULL DEFAULT '',
    status         text        NOT NULL DEFAULT 'seen'
                               CHECK (status IN ('seen', 'discarded', 'applied')),
    application_id uuid        NULL REFERENCES applications(id) ON DELETE SET NULL,
    snapshot       jsonb       NOT NULL,
    annotations    jsonb       NOT NULL DEFAULT '{}',
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_seen_url_uniq
    ON job_seen (owner_id, url_key) WHERE url_key <> '';
CREATE UNIQUE INDEX IF NOT EXISTS job_seen_key_uniq
    ON job_seen (owner_id, composite_key) WHERE composite_key <> '';
CREATE INDEX IF NOT EXISTS job_seen_owner_time_idx ON job_seen (owner_id, first_seen_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS company_marks (
    owner_id    uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    company_key text        NOT NULL,
    mark        text        NOT NULL CHECK (mark IN ('do_not_apply')),
    note        text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, company_key)
);
