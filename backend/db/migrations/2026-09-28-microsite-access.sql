-- 2026-09-28-microsite-access.sql — "open without an access code", per page. Reentrant: safe to
-- run on a database that already has it.
--
-- The owner's pages table showed a switch under "no code opens this — anonymous only" and read it
-- as "may this page be opened without a code"; nothing enforced that — /p/<slug> served every
-- page to everyone. Owner decision (2026-09-28): the switch means exactly that, and a page with a
-- code bound starts closed. No row = that default (open iff no active code is bound to the page);
-- a row = the owner's explicit choice.
-- events: none (owner configuration)
CREATE TABLE IF NOT EXISTS microsite_access (
    page_id           uuid        PRIMARY KEY REFERENCES microsites(id) ON DELETE CASCADE,
    owner_id          uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    open_without_code boolean     NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- microsite_opens_without_code —— the ONE definition of "may this page be opened without a code":
-- the owner's explicit choice, else open iff no active code is bound. Every reader (the admin list,
-- the serve check) calls this, so the default rule cannot drift between them.
CREATE OR REPLACE FUNCTION microsite_opens_without_code(page uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT ma.open_without_code FROM microsite_access ma WHERE ma.page_id = page),
        NOT EXISTS (SELECT 1 FROM access_codes ac WHERE ac.microsite_id = page AND ac.status = 'active')
    )
$$;
