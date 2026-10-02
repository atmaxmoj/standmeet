-- 2026-10-02-microsite-store-policy.sql — the owner's rules for one page's store
-- (docs/design/scenario-s2-collaborative-writing.md): how many documents it may hold, and whether
-- a new document waits for approval. Reentrant: safe to run on a database that already has it.

-- events: none (owner configuration)
CREATE TABLE IF NOT EXISTS microsite_store_policy (
    page_id     uuid        PRIMARY KEY REFERENCES microsites(id) ON DELETE CASCADE,
    max_docs    integer     NOT NULL DEFAULT 500 CHECK (max_docs > 0),
    review      boolean     NOT NULL DEFAULT false,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
